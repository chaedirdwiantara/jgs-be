/**
 * A rental schedule entry: a confirmed booking the operator keys into the
 * console once a renter and a unit are agreed.
 *
 * This is deliberately separate from `RentalApplication`. An application is
 * what a stranger submits from the public form and may never become a rental;
 * a rental is money and a car on a date. Conflating the two would make the
 * schedule show hopefuls next to bookings.
 */

import { rentalEndDate } from "../shared/dates.js";

export const PAYMENT_STATUSES = ["belum_dibayar", "sudah_dibayar"] as const;

/**
 * Longest rental the console accepts, matching the public form. The
 * repository leans on this bound to turn "overlaps this month" into a bounded
 * index query, so raising it here is what makes raising it there safe.
 */
export const MAX_DURATION_DAYS = 90;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  belum_dibayar: "Belum Dibayar",
  sudah_dibayar: "Sudah Dibayar",
};

/** The fields the console sends; everything else is derived or bookkeeping. */
export type RentalDetails = {
  customerName: string;
  /** Normalised `628…`, same as the application form. */
  customerPhone: string;
  /** Catalogue slug (`byd-seal`), so the schedule can be grouped per model. */
  vehicleId: string;
  /** The model name as shown when the entry was made — see `vehicleLabel` on applications. */
  vehicleLabel: string;
  /** Registration plate of the physical unit, uppercase, no spaces. Empty when not yet assigned. */
  plateNumber: string;
  /** `YYYY-MM-DD`, WIB calendar date the renter picks the car up. */
  startDate: string;
  /** `HH:mm`, WIB. */
  startTime: string;
  durationDays: number;
  /** IDR per day, as agreed — not necessarily the catalogue rate. */
  dailyRate: number;
  paymentStatus: PaymentStatus;
  /** `YYYY-MM-DD`. Past this date an unpaid rental is overdue. */
  paymentDueDate: string;
  /** Console-only free text. */
  notes: string;
};

/**
 * When each reminder was last sent, as the WIB calendar date of the run.
 *
 * Reminders are sent by a daily job that may be re-run — after a failed
 * invocation, or by hand while debugging. Recording the date rather than a
 * boolean makes a re-run on the same day a no-op while still letting the
 * overdue nudge repeat on the next day.
 */
export type ReminderLedger = {
  pickupSentOn: string | null;
  returnSentOn: string | null;
  overdueSentOn: string | null;
};

export type Rental = RentalDetails & {
  id: string;
  /** Inclusive last day, derived from `startDate` + `durationDays`. Stored so it can be indexed. */
  endDate: string;
  /** Set when the status first moves to paid. */
  paidAt: string | null;
  reminders: ReminderLedger;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export const EMPTY_LEDGER: ReminderLedger = {
  pickupSentOn: null,
  returnSentOn: null,
  overdueSentOn: null,
};

export function rentalTotal(rental: Pick<Rental, "dailyRate" | "durationDays">): number {
  return rental.dailyRate * rental.durationDays;
}

export function isPaid(rental: Pick<Rental, "paymentStatus">): boolean {
  return rental.paymentStatus === "sudah_dibayar";
}

/** Overdue means strictly *after* the due date: on the due date itself it is still on time. */
export function isOverdue(rental: Pick<Rental, "paymentStatus" | "paymentDueDate">, today: string): boolean {
  return !isPaid(rental) && rental.paymentDueDate < today;
}

/** Builds the derived fields from what the console sent. */
export function withDerivedFields<T extends RentalDetails>(details: T): T & { endDate: string } {
  return { ...details, endDate: rentalEndDate(details.startDate, details.durationDays) };
}
