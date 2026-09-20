import { describe, expect, it } from "vitest";

import type { Clock, IdGenerator } from "../src/domain/shared/ports.js";
import {
  makeCreateRental,
  makeListRentals,
  makeUpdateRental,
} from "../src/usecases/rentals/manage-rentals.js";
import { baseDetails, baseRental, memoryRentals, recordingChat } from "./rental-helpers.js";

const clock: Clock = { now: () => "2026-09-10T02:00:00.000Z" };
const ids: IdGenerator = { generate: () => "rental-1" };
const actor = { id: "user-1", name: "Siti", role: "staff" as const };

function build(seed: ReturnType<typeof baseRental>[] = []) {
  const { repository, store } = memoryRentals(seed);
  const { chat, sent } = recordingChat();
  const deps = { rentals: repository, chat, clock, ids, consoleBaseUrl: "https://jgs-ev.com" };
  return {
    store,
    sent,
    create: makeCreateRental(deps),
    update: makeUpdateRental(deps),
    list: makeListRentals({ rentals: repository }),
  };
}

describe("createRental", () => {
  it("derives the inclusive end date and announces the entry", async () => {
    const { create, store, sent } = build();

    const rental = await create(actor, baseDetails({ startDate: "2026-09-17", durationDays: 4 }));

    expect(rental.endDate).toBe("2026-09-20");
    expect(rental.createdBy).toBe("Siti");
    expect(rental.paidAt).toBeNull();
    expect(store.get("rental-1")).toEqual(rental);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Jadwal Rental Baru");
    expect(sent[0]).toContain("Budi Santoso");
    expect(sent[0]).toContain("B1234XYZ");
    expect(sent[0]).toContain("Rp 3.000.000");
    expect(sent[0]).toContain("Belum Dibayar");
    expect(sent[0]).toContain("/admin/rental/?id=rental-1");
  });

  it("dates the payment when the entry is created already paid", async () => {
    const { create, sent } = build();

    const rental = await create(actor, baseDetails({ paymentStatus: "sudah_dibayar" }));

    expect(rental.paidAt).toBe("2026-09-10T02:00:00.000Z");
    expect(sent[0]).toContain("Sudah Dibayar");
  });

  it("escapes what the operator typed", async () => {
    const { create, sent } = build();

    await create(actor, baseDetails({ customerName: "<b>Budi</b>" }));

    expect(sent[0]).toContain("&lt;b&gt;Budi&lt;/b&gt;");
    expect(sent[0]).not.toContain("<b>Budi</b>");
  });
});

describe("updateRental", () => {
  it("announces the payment exactly once, when the status flips to paid", async () => {
    const { store, update, sent } = build();
    store.set("rental-1", baseRental());

    await update(actor, "rental-1", baseDetails({ paymentStatus: "sudah_dibayar" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Pembayaran Diterima");
    expect(store.get("rental-1")?.paidAt).toBe("2026-09-10T02:00:00.000Z");

    // Editing a paid rental again is not a second payment.
    await update(actor, "rental-1", baseDetails({ paymentStatus: "sudah_dibayar", notes: "x" }));
    expect(sent).toHaveLength(1);
  });

  it("keeps the reminder ledger unless the date it refers to moved", async () => {
    const { store, update } = build();
    store.set(
      "rental-1",
      baseRental({
        reminders: { pickupSentOn: "2026-09-16", returnSentOn: "2026-09-18", overdueSentOn: null },
      }),
    );

    // Same dates: nothing resets.
    await update(actor, "rental-1", baseDetails({ notes: "catatan" }));
    expect(store.get("rental-1")?.reminders).toEqual({
      pickupSentOn: "2026-09-16",
      returnSentOn: "2026-09-18",
      overdueSentOn: null,
    });

    // Pick-up moved: its reminder is due again, the return one is too since the end moved with it.
    await update(actor, "rental-1", baseDetails({ startDate: "2026-09-24" }));
    expect(store.get("rental-1")?.reminders).toEqual({
      pickupSentOn: null,
      returnSentOn: null,
      overdueSentOn: null,
    });
  });

  it("rejects an unknown id", async () => {
    const { update } = build();
    await expect(update(actor, "missing", baseDetails())).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("listRentals", () => {
  it("returns rentals that overlap the window, not only those that start in it", async () => {
    const { store, list } = build();
    store.set("aug", baseRental({ id: "aug", startDate: "2026-08-25", durationDays: 10, endDate: "2026-09-03" }));
    store.set("sep", baseRental({ id: "sep", startDate: "2026-09-10", durationDays: 1, endDate: "2026-09-10" }));
    store.set("oct", baseRental({ id: "oct", startDate: "2026-10-01", durationDays: 1, endDate: "2026-10-01" }));

    const items = await list(actor, { from: "2026-09-01", to: "2026-09-30" });

    expect(items.map((r) => r.id).sort()).toEqual(["aug", "sep"]);
  });

  it("refuses an inverted or oversized window", async () => {
    const { list } = build();
    await expect(list(actor, { from: "2026-09-30", to: "2026-09-01" })).rejects.toMatchObject({
      code: "validation",
    });
    await expect(list(actor, { from: "2026-01-01", to: "2026-12-31" })).rejects.toMatchObject({
      code: "validation",
    });
  });
});
