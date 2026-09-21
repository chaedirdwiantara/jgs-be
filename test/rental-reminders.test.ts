import { describe, expect, it } from "vitest";

import type { Clock } from "../src/domain/shared/ports.js";
import { makeSendRentalReminders } from "../src/usecases/rentals/send-rental-reminders.js";
import { baseRental, memoryRentals, recordingChat } from "./rental-helpers.js";

/** 08:00 WIB on 16 Sep 2026 is 01:00 UTC. */
const clock: Clock = { now: () => "2026-09-16T01:00:00.000Z" };

function build(seed: ReturnType<typeof baseRental>[]) {
  const { repository, store } = memoryRentals(seed);
  const { chat, sent } = recordingChat();
  const run = makeSendRentalReminders({
    rentals: repository,
    chat,
    clock,
    consoleBaseUrl: "https://jgs-ev.com",
  });
  return { run, store, sent };
}

describe("sendRentalReminders", () => {
  it("evaluates the day in Jakarta, not UTC", async () => {
    // 23:30 UTC on the 15th is already 06:30 WIB on the 16th.
    const { repository } = memoryRentals([]);
    const { chat } = recordingChat();
    const run = makeSendRentalReminders({
      rentals: repository,
      chat,
      clock: { now: () => "2026-09-15T23:30:00.000Z" },
      consoleBaseUrl: "https://jgs-ev.com",
    });

    expect((await run()).today).toBe("2026-09-16");
  });

  it("sends one digest per category for tomorrow's pick-ups and returns", async () => {
    const { run, sent } = build([
      baseRental({ id: "a", customerName: "Andi", startDate: "2026-09-17", durationDays: 2, endDate: "2026-09-18" }),
      baseRental({ id: "b", customerName: "Bela", startDate: "2026-09-17", durationDays: 1, endDate: "2026-09-17" }),
      baseRental({ id: "c", customerName: "Cici", startDate: "2026-09-14", durationDays: 4, endDate: "2026-09-17", paymentStatus: "sudah_dibayar" }),
      baseRental({ id: "d", customerName: "Dodi", startDate: "2026-09-20", durationDays: 1, endDate: "2026-09-20" }),
    ]);

    const summary = await run();

    expect(summary).toEqual({ today: "2026-09-16", pickups: 2, returns: 2, overdue: 0 });
    expect(sent).toHaveLength(2);

    expect(sent[0]).toContain("Besok 2 unit keluar");
    expect(sent[0]).toContain("Andi");
    expect(sent[0]).toContain("Bela");
    expect(sent[0]).not.toContain("Dodi");

    expect(sent[1]).toContain("Besok 2 unit kembali");
    expect(sent[1]).toContain("Bela");
    expect(sent[1]).toContain("Cici");
  });

  it("nags about unpaid rentals only once they are past due", async () => {
    // All three start next week, so no pick-up or return digest interferes.
    const later = { startDate: "2026-09-23", endDate: "2026-09-25" };
    const { run, sent } = build([
      baseRental({ id: "due-today", ...later, paymentDueDate: "2026-09-16" }),
      baseRental({ id: "late", ...later, customerName: "Lala", paymentDueDate: "2026-09-15" }),
      baseRental({ id: "paid-late", ...later, paymentDueDate: "2026-09-01", paymentStatus: "sudah_dibayar" }),
    ]);

    const summary = await run();

    expect(summary.overdue).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("1 pembayaran lewat jatuh tempo");
    expect(sent[0]).toContain("Lala");
  });

  it("is a no-op when re-run on the same day, and fires again the next day", async () => {
    const { repository, store } = memoryRentals([
      baseRental({ id: "late", paymentDueDate: "2026-09-10" }),
      baseRental({ id: "tmrw", startDate: "2026-09-17", durationDays: 1, endDate: "2026-09-17" }),
    ]);
    const { chat, sent } = recordingChat();
    let now = "2026-09-16T01:00:00.000Z";
    const run = makeSendRentalReminders({
      rentals: repository,
      chat,
      clock: { now: () => now },
      consoleBaseUrl: "https://jgs-ev.com",
    });

    await run();
    expect(sent).toHaveLength(3); // pick-up, return (1-day rental), overdue
    expect(store.get("tmrw")?.reminders).toEqual({
      pickupSentOn: "2026-09-16",
      returnSentOn: "2026-09-16",
      overdueSentOn: null,
    });

    const again = await run();
    expect(again).toEqual({ today: "2026-09-16", pickups: 0, returns: 0, overdue: 0 });
    expect(sent).toHaveLength(3);

    now = "2026-09-17T01:00:00.000Z";
    const nextDay = await run();
    expect(nextDay).toEqual({ today: "2026-09-17", pickups: 0, returns: 0, overdue: 1 });
    expect(sent).toHaveLength(4);
  });
});
