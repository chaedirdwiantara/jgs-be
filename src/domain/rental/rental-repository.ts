import type { ReminderLedger, Rental } from "./rental.js";

export interface RentalRepository {
  /**
   * Every rental whose period touches `[from, to]` (both inclusive calendar
   * dates), earliest start first. This is the month view: a rental that began
   * last month but is still running belongs in it.
   */
  listOverlapping(from: string, to: string): Promise<Rental[]>;
  /** Rentals that pick up on exactly `date`. */
  listStartingOn(date: string): Promise<Rental[]>;
  /** Rentals whose inclusive last day is exactly `date`. */
  listEndingOn(date: string): Promise<Rental[]>;
  /** Unpaid rentals whose due date is strictly before `date`. */
  listUnpaidDueBefore(date: string): Promise<Rental[]>;
  findById(id: string): Promise<Rental | null>;
  create(rental: Rental): Promise<void>;
  /** Replaces the record wholesale; the console always sends every field. */
  replace(rental: Rental): Promise<void>;
  /**
   * Writes one ledger entry without touching the rest of the record. Atomic
   * on purpose: the daily job stamps the same rental from several lists and
   * must not race itself (or an operator editing the entry) with a full write.
   */
  stampReminder(id: string, key: keyof ReminderLedger, sentOn: string): Promise<void>;
  remove(id: string): Promise<void>;
}
