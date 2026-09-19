import type {
  ApplicantDetails,
  RentalApplication,
  RentalDetails,
  StoredDocument,
} from "../../domain/application/rental-application.js";
import {
  buildReferenceCode,
  DOCUMENT_SLOT_KEYS,
  REQUIRED_DOCUMENT_SLOTS,
  resolvedVehicle,
  type DocumentSlot,
} from "../../domain/application/rental-application.js";
import type { ApplicationRepository } from "../../domain/application/application-repository.js";
import type { ChatNotifier } from "../../domain/notification/chat-notifier.js";
import type { NotificationRepository } from "../../domain/notification/notification-repository.js";
import { RateLimitedError, ValidationError } from "../../domain/shared/errors.js";
import type { Clock, IdGenerator, RateLimiter } from "../../domain/shared/ports.js";
import type { DocumentStorage } from "../../domain/storage/document-storage.js";
import type { UserRepository } from "../../domain/user/user-repository.js";

/** What the browser sends: the form values plus the keys it already uploaded. */
export type SubmitApplicationCommand = ApplicantDetails &
  RentalDetails & {
    /** Staging object keys returned by `POST /uploads`, keyed by slot. */
    documentKeys: Partial<Record<DocumentSlot, string>>;
    /** Original file names, for the console's download filename. */
    documentNames: Partial<Record<DocumentSlot, string>>;
    clientIp: string;
  };

/**
 * Counts *accepted* submissions only; see `submitApplication` for why.
 *
 * Sized for a shared address, not a person. Indonesian mobile operators put
 * thousands of subscribers behind one public IP (carrier-grade NAT), so two
 * unrelated renters on the same network in the same hour is ordinary — while
 * ten stored applications from one address is still far beyond anything but a
 * script.
 */
const MAX_SUBMISSIONS_PER_IP = 10;
const SUBMISSION_WINDOW_SECONDS = 60 * 60;

export function makeSubmitApplication(deps: {
  applications: ApplicationRepository;
  notifications: NotificationRepository;
  users: UserRepository;
  storage: DocumentStorage;
  chat: ChatNotifier;
  clock: Clock;
  ids: IdGenerator;
  rateLimiter: RateLimiter;
  /** Where the console lives, for the link in the Telegram message. */
  consoleBaseUrl: string;
}) {
  return async function submitApplication(
    command: SubmitApplicationCommand,
  ): Promise<{ id: string; referenceCode: string }> {
    /*
     * Validation comes before the budget is charged, and the charge is handed
     * back if the attempt still fails before a record exists. Only a stored
     * application spends budget: the limit is there to cap how many
     * submissions one address can land in the console, not how many times a
     * renter may get a form wrong. Counting failures locked a real renter out
     * for an hour after five rejected tries — the very case this must absorb.
     */
    assertRequiredDocuments(command.documentKeys);

    const budgetKey = `apply:ip:${command.clientIp}`;
    const budget = await deps.rateLimiter.hit(
      budgetKey,
      MAX_SUBMISSIONS_PER_IP,
      SUBMISSION_WINDOW_SECONDS,
    );
    if (!budget.allowed) throw RateLimitedError(budget.retryAfterSeconds);

    const now = deps.clock.now();
    const id = deps.ids.generate();

    let application: RentalApplication;
    try {
      /*
       * Files move to their permanent home *before* the record is written. The
       * other order can leave an application pointing at keys that expired out
       * of the staging prefix, which reads as data loss to whoever opens it.
       */
      const documents = await promoteDocuments(deps.storage, id, command);

      application = buildApplication(id, now, documents, command);
      await deps.applications.create(application);
    } catch (cause) {
      await deps.rateLimiter.refund(budgetKey, SUBMISSION_WINDOW_SECONDS);
      throw cause;
    }

    /*
     * Notifications are a side effect of a submission that already succeeded.
     * Neither an unreachable Telegram nor a failed fan-out may turn a stored
     * application into an error the renter sees, so both are caught here.
     */
    await Promise.allSettled([
      fanOutToConsole(deps, application),
      deps.chat.send(buildTelegramMessage(application, deps.consoleBaseUrl)),
    ]);

    return { id: application.id, referenceCode: application.referenceCode };
  };
}

function buildApplication(
  id: string,
  now: string,
  documents: Partial<Record<DocumentSlot, StoredDocument>>,
  command: SubmitApplicationCommand,
): RentalApplication {
  return {
    id,
    referenceCode: buildReferenceCode(now, Math.random),
    status: "baru",
    internalNote: "",
    documents,
    submittedAt: now,
    updatedAt: now,
    reviewedAt: null,
    reviewedBy: null,

    email: command.email,
    fullName: command.fullName,
    address: command.address,
    whatsapp: command.whatsapp,
    gsmNumber: command.gsmNumber,
    emergencyNumber: command.emergencyNumber,
    socialPlatform: command.socialPlatform,
    socialAccount: command.socialAccount,

    purpose: command.purpose,
    usageLocation: command.usageLocation,
    startDate: command.startDate,
    startTime: command.startTime,
    durationDays: command.durationDays,
    vehicleChoice: command.vehicleChoice,
    vehicleLabel: command.vehicleLabel,
    vehicleOther: command.vehicleOther,
    withDriver: command.withDriver,
    referralSource: command.referralSource,
    referralSourceOther: command.referralSourceOther,
  };
}

function assertRequiredDocuments(keys: Partial<Record<DocumentSlot, string>>): void {
  const missing = REQUIRED_DOCUMENT_SLOTS.filter((slot) => !keys[slot]);
  if (missing.length === 0) return;

  throw ValidationError(
    "Beberapa dokumen wajib belum terunggah.",
    Object.fromEntries(missing.map((slot) => [slot, "Dokumen ini wajib diunggah."])),
  );
}

async function promoteDocuments(
  storage: DocumentStorage,
  applicationId: string,
  command: SubmitApplicationCommand,
): Promise<Partial<Record<DocumentSlot, StoredDocument>>> {
  const documents: Partial<Record<DocumentSlot, StoredDocument>> = {};

  for (const slot of DOCUMENT_SLOT_KEYS) {
    const stagingKey = command.documentKeys[slot];
    if (!stagingKey) continue;

    const extension = stagingKey.slice(stagingKey.lastIndexOf("."));
    const finalKey = `applications/${applicationId}/${slot}${extension}`;

    const { contentType, sizeBytes } = await storage.promote(stagingKey, finalKey);

    documents[slot] = {
      key: finalKey,
      contentType,
      sizeBytes,
      originalName: command.documentNames[slot] ?? `${slot}${extension}`,
    };
  }

  return documents;
}

async function fanOutToConsole(
  deps: {
    users: UserRepository;
    notifications: NotificationRepository;
    ids: IdGenerator;
    clock: Clock;
  },
  application: RentalApplication,
): Promise<void> {
  const recipients = await deps.users.listActiveIds();
  if (recipients.length === 0) return;

  const createdAt = deps.clock.now();

  await deps.notifications.createMany(
    recipients.map((userId) => ({
      id: deps.ids.generate(),
      userId,
      type: "application.submitted" as const,
      title: "Formulir penyewa baru",
      body: `${application.fullName} — ${resolvedVehicle(application)}, ${application.durationDays} hari mulai ${application.startDate}.`,
      href: `/admin/?id=${application.id}`,
      createdAt,
      readAt: null,
    })),
  );
}

/**
 * Telegram renders a small HTML subset; anything the renter typed is escaped so
 * a `<` in an address cannot break the message (or inject markup).
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildTelegramMessage(application: RentalApplication, consoleBaseUrl: string): string {
  const driver = application.withDriver ? "Dengan driver" : "Lepas kunci";
  const documents = Object.keys(application.documents).length;

  return [
    "🚗 <b>Formulir Penyewa Baru</b>",
    `<code>${escapeHtml(application.referenceCode)}</code>`,
    "",
    `👤 <b>${escapeHtml(application.fullName)}</b>`,
    `📱 ${escapeHtml(application.whatsapp)}`,
    `✉️ ${escapeHtml(application.email)}`,
    "",
    `🚙 ${escapeHtml(resolvedVehicle(application))} · ${driver}`,
    `📅 ${escapeHtml(application.startDate)} ${escapeHtml(application.startTime)} WIB · ${application.durationDays} hari`,
    `📍 ${escapeHtml(application.usageLocation)}`,
    `🎯 ${escapeHtml(application.purpose)}`,
    `📎 ${documents} dokumen terlampir`,
    "",
    `<a href="${consoleBaseUrl}/admin/?id=${application.id}">Buka di konsol admin</a>`,
  ].join("\n");
}
