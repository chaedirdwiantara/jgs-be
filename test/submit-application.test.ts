import { describe, expect, it, vi } from "vitest";

import type { ApplicationRepository } from "../src/domain/application/application-repository.js";
import type { RentalApplication } from "../src/domain/application/rental-application.js";
import { buildReferenceCode } from "../src/domain/application/rental-application.js";
import type { ChatNotifier } from "../src/domain/notification/chat-notifier.js";
import type { Notification } from "../src/domain/notification/notification.js";
import type { NotificationRepository } from "../src/domain/notification/notification-repository.js";
import { describeWait, ValidationError } from "../src/domain/shared/errors.js";
import type { Clock, IdGenerator, RateLimiter } from "../src/domain/shared/ports.js";
import type { DocumentStorage } from "../src/domain/storage/document-storage.js";
import type { UserRepository } from "../src/domain/user/user-repository.js";
import {
  makeSubmitApplication,
  type SubmitApplicationCommand,
} from "../src/usecases/applications/submit-application.js";

const clock: Clock = { now: () => "2026-09-17T09:00:00.000Z" };

function makeIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const allowAll: RateLimiter = {
  hit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
  refund: async () => {},
};

/** Counts hits per key so budget accounting can be asserted, not just outcomes. */
function makeRateLimiter(limit: number) {
  const hits = new Map<string, number>();
  const limiter: RateLimiter = {
    hit: vi.fn(async (key: string) => {
      const next = (hits.get(key) ?? 0) + 1;
      hits.set(key, next);
      return { allowed: next <= limit, retryAfterSeconds: 1_500 };
    }),
    refund: vi.fn(async (key: string) => {
      hits.set(key, Math.max(0, (hits.get(key) ?? 0) - 1));
    }),
  };
  return { limiter, hits };
}

function baseCommand(
  overrides: Partial<SubmitApplicationCommand> = {},
): SubmitApplicationCommand {
  return {
    email: "budi@example.com",
    fullName: "Budi Santoso",
    address: "Jl. Catur No. 10, Jakarta Selatan",
    whatsapp: "628118030900",
    gsmNumber: "628118030901",
    emergencyNumber: "628118030902",
    socialPlatform: "instagram",
    socialAccount: "budi.santoso",
    purpose: "Perjalanan keluarga",
    usageLocation: "Jakarta - Bandung",
    startDate: "2026-09-20",
    startTime: "09:00",
    durationDays: 3,
    vehicleChoice: "byd-seal",
    vehicleLabel: "BYD Seal",
    vehicleOther: null,
    withDriver: false,
    referralSource: "ig",
    referralSourceOther: null,
    documentKeys: {
      ktp: "uploads/a1/ktp.jpg",
      selfieKtp: "uploads/a2/selfieKtp.jpg",
      sim: "uploads/a3/sim.jpg",
      kartuKeluarga: "uploads/a4/kartuKeluarga.jpg",
    },
    documentNames: { ktp: "ktp-budi.jpg" },
    clientIp: "1.1.1.1",
    ...overrides,
  };
}

function build(options: { chat?: ChatNotifier; rateLimiter?: RateLimiter } = {}) {
  const created: RentalApplication[] = [];
  const notifications: Notification[] = [];
  const promoted: Array<[string, string]> = [];

  const applications = {
    create: vi.fn(async (application: RentalApplication) => void created.push(application)),
    list: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    countByStatus: vi.fn(),
  } as unknown as ApplicationRepository;

  const storage: DocumentStorage = {
    createUploadTicket: vi.fn(),
    createDownloadUrl: vi.fn(),
    promote: vi.fn(async (stagingKey: string, finalKey: string) => {
      promoted.push([stagingKey, finalKey]);
      return { contentType: "image/jpeg", sizeBytes: 1234 };
    }),
    remove: vi.fn(async () => {}),
  };

  const users = {
    listActiveIds: async () => ["user-1", "user-2"],
  } as unknown as UserRepository;

  const notificationRepository = {
    createMany: vi.fn(async (items: Notification[]) => void notifications.push(...items)),
    listForUser: vi.fn(),
    countUnread: vi.fn(),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  } as unknown as NotificationRepository;

  const chat = options.chat ?? { send: vi.fn(async () => {}) };

  const submit = makeSubmitApplication({
    applications,
    notifications: notificationRepository,
    users,
    storage,
    chat,
    clock,
    ids: makeIds(),
    rateLimiter: options.rateLimiter ?? allowAll,
    consoleBaseUrl: "https://jgs-ev.com",
  });

  return { submit, created, notifications, promoted, storage, chat, applications };
}

describe("submitApplication", () => {
  it("stores the submission and returns a quotable reference", async () => {
    const { submit, created } = build();

    const result = await submit(baseCommand());

    expect(created).toHaveLength(1);
    expect(result.referenceCode).toMatch(/^JGS-260917-[2-9A-HJ-NP-Z]{4}$/);
    expect(created[0]?.status).toBe("baru");
    expect(created[0]?.reviewedAt).toBeNull();
  });

  it("moves every uploaded photo out of the staging prefix", async () => {
    const { submit, promoted, created } = build();

    await submit(baseCommand());

    expect(promoted).toHaveLength(4);
    for (const [staging, final] of promoted) {
      expect(staging.startsWith("uploads/")).toBe(true);
      expect(final.startsWith("applications/")).toBe(true);
    }
    expect(created[0]?.documents.ktp?.key).toBe("applications/id-1/ktp.jpg");
  });

  it("records the size and type the store reports, not what the browser claimed", async () => {
    const { submit, created } = build();

    await submit(baseCommand());

    expect(created[0]?.documents.ktp).toMatchObject({
      contentType: "image/jpeg",
      sizeBytes: 1234,
      originalName: "ktp-budi.jpg",
    });
  });

  it("refuses a submission missing a required document", async () => {
    const { submit, created } = build();

    const command = baseCommand();
    delete command.documentKeys.sim;

    await expect(submit(command)).rejects.toMatchObject({
      code: "validation",
      fieldErrors: { sim: "Dokumen ini wajib diunggah." },
    });
    expect(created).toHaveLength(0);
  });

  it("notifies every active console account", async () => {
    const { submit, notifications } = build();

    await submit(baseCommand());

    expect(notifications.map((item) => item.userId)).toEqual(["user-1", "user-2"]);
    expect(notifications[0]).toMatchObject({ type: "application.submitted", readAt: null });
  });

  it("still succeeds when Telegram is down", async () => {
    // The renter's form must not fail because a chat bot is unreachable.
    const chat: ChatNotifier = {
      send: vi.fn(async () => {
        throw new Error("telegram unreachable");
      }),
    };
    const { submit, created } = build({ chat });

    await expect(submit(baseCommand())).resolves.toMatchObject({ id: "id-1" });
    expect(created).toHaveLength(1);
  });

  it("rejects once the per-IP budget is spent, and says how long to wait", async () => {
    const { limiter } = makeRateLimiter(0);
    const { submit, created } = build({ rateLimiter: limiter });

    await expect(submit(baseCommand())).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterSeconds: 1_500,
      message: "Terlalu banyak percobaan. Coba lagi dalam 25 menit.",
    });
    expect(created).toHaveLength(0);
  });

  it("does not spend budget on a submission that fails validation", async () => {
    // A renter who is missing a document may fix it and try again as often as
    // it takes; only accepted submissions count against the address.
    const { limiter, hits } = makeRateLimiter(1);
    const { submit } = build({ rateLimiter: limiter });

    await expect(
      submit(baseCommand({ documentKeys: { ktp: "uploads/a1/ktp.jpg" } })),
    ).rejects.toMatchObject({ code: "validation" });

    expect(limiter.hit).not.toHaveBeenCalled();
    expect(hits.get("apply:ip:1.1.1.1") ?? 0).toBe(0);
  });

  it("hands the budget back when an upload can no longer be found", async () => {
    const { limiter, hits } = makeRateLimiter(1);
    const { submit, storage, created } = build({ rateLimiter: limiter });
    vi.mocked(storage.promote).mockRejectedValueOnce(
      ValidationError("Berkas yang diunggah sudah kedaluwarsa. Unggah ulang dokumen Anda."),
    );

    await expect(submit(baseCommand())).rejects.toMatchObject({ code: "validation" });
    expect(created).toHaveLength(0);
    expect(limiter.refund).toHaveBeenCalledWith("apply:ip:1.1.1.1", 3_600);
    expect(hits.get("apply:ip:1.1.1.1")).toBe(0);

    // The retry, with the document re-uploaded, still fits in a budget of one.
    await expect(submit(baseCommand())).resolves.toMatchObject({ id: "id-2" });
  });

  it("keeps the charge for a stored submission", async () => {
    const { limiter, hits } = makeRateLimiter(1);
    const { submit } = build({ rateLimiter: limiter });

    await submit(baseCommand());

    expect(limiter.refund).not.toHaveBeenCalled();
    expect(hits.get("apply:ip:1.1.1.1")).toBe(1);
  });
});

describe("describeWait", () => {
  it("rounds up to whole minutes and never says zero", () => {
    expect(describeWait(0)).toBe("1 menit");
    expect(describeWait(59)).toBe("1 menit");
    expect(describeWait(61)).toBe("2 menit");
    expect(describeWait(3_600)).toBe("60 menit");
  });
});

describe("buildReferenceCode", () => {
  it("uses the submission date and an unambiguous alphabet", () => {
    const code = buildReferenceCode("2026-09-17T09:00:00.000Z", () => 0);
    expect(code).toBe("JGS-260917-2222");
  });

  it("omits characters that are misread over the phone", () => {
    const code = buildReferenceCode("2026-01-05T00:00:00.000Z", () => 0.999999);

    // Only the random suffix draws from the restricted alphabet — the date
    // segment is digits by definition and may legitimately contain 0 and 1.
    expect(code.split("-")[2]).not.toMatch(/[01OI]/);
  });
});
