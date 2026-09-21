import type { ChatNotifier } from "../../domain/notification/chat-notifier.js";
import type { ReminderLedger, Rental } from "../../domain/rental/rental.js";
import type { RentalRepository } from "../../domain/rental/rental-repository.js";
import { addDays, calendarDateInJakarta } from "../../domain/shared/dates.js";
import type { Clock } from "../../domain/shared/ports.js";
import {
  overdueReminderMessage,
  pickupReminderMessage,
  returnReminderMessage,
} from "./rental-messages.js";

export type ReminderRunSummary = {
  /** The WIB calendar date the run was evaluated for. */
  today: string;
  pickups: number;
  returns: number;
  overdue: number;
};

/**
 * The daily job behind the three scheduled alerts: tomorrow's pick-ups,
 * tomorrow's returns, and unpaid rentals past due.
 *
 * Idempotent per calendar day. Each rental remembers the date its reminder
 * went out, and a rental already stamped with today's date is skipped — so a
 * retried or hand-triggered run repeats nothing, while the overdue nudge still
 * fires again tomorrow.
 *
 * The stamp is written *before* the message is sent, one rental at a time. A
 * duplicate alert is a minor annoyance; a missed one is a car nobody prepared.
 * Stamping first means a crash mid-batch can only ever lose a message, never
 * repeat one, and a failed write leaves that rental for the next run.
 */
export function makeSendRentalReminders(deps: {
  rentals: RentalRepository;
  chat: ChatNotifier;
  clock: Clock;
  consoleBaseUrl: string;
}) {
  return async function sendRentalReminders(): Promise<ReminderRunSummary> {
    const today = calendarDateInJakarta(deps.clock.now());
    const tomorrow = addDays(today, 1);

    const [starting, ending, unpaid] = await Promise.all([
      deps.rentals.listStartingOn(tomorrow),
      deps.rentals.listEndingOn(tomorrow),
      deps.rentals.listUnpaidDueBefore(today),
    ]);

    const pickups = await stampAndCollect(deps.rentals, starting, "pickupSentOn", today);
    if (pickups.length > 0) {
      await deps.chat.send(pickupReminderMessage(pickups, tomorrow, deps.consoleBaseUrl));
    }

    const returns = await stampAndCollect(deps.rentals, ending, "returnSentOn", today);
    if (returns.length > 0) {
      await deps.chat.send(returnReminderMessage(returns, tomorrow, deps.consoleBaseUrl));
    }

    const overdue = await stampAndCollect(deps.rentals, unpaid, "overdueSentOn", today);
    if (overdue.length > 0) {
      await deps.chat.send(overdueReminderMessage(overdue, today, deps.consoleBaseUrl));
    }

    return { today, pickups: pickups.length, returns: returns.length, overdue: overdue.length };
  };
}

async function stampAndCollect(
  rentals: RentalRepository,
  candidates: Rental[],
  ledgerKey: keyof ReminderLedger,
  today: string,
): Promise<Rental[]> {
  const due: Rental[] = [];

  for (const rental of candidates) {
    if (rental.reminders[ledgerKey] === today) continue;

    await rentals.stampReminder(rental.id, ledgerKey, today);
    due.push({ ...rental, reminders: { ...rental.reminders, [ledgerKey]: today } });
  }

  return due;
}
