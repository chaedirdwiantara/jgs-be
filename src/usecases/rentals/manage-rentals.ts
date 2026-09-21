import type { ChatNotifier } from "../../domain/notification/chat-notifier.js";
import {
  EMPTY_LEDGER,
  isPaid,
  withDerivedFields,
  type Rental,
  type RentalDetails,
} from "../../domain/rental/rental.js";
import type { RentalRepository } from "../../domain/rental/rental-repository.js";
import { NotFoundError, ValidationError } from "../../domain/shared/errors.js";
import { isCalendarDate } from "../../domain/shared/dates.js";
import type { Clock, IdGenerator } from "../../domain/shared/ports.js";
import type { User } from "../../domain/user/user.js";
import { rentalCreatedMessage, rentalPaidMessage } from "./rental-messages.js";

export type Actor = Pick<User, "id" | "name" | "role">;

export type ListRentalsQuery = {
  /** Inclusive calendar dates. */
  from: string;
  to: string;
};

/** Widest window one request may ask for: a quarter, so a scan is never a year. */
const MAX_WINDOW_DAYS = 93;

export function makeListRentals(deps: { rentals: RentalRepository }) {
  return async function listRentals(_actor: Actor, query: ListRentalsQuery): Promise<Rental[]> {
    if (!isCalendarDate(query.from) || !isCalendarDate(query.to) || query.from > query.to) {
      throw ValidationError("Rentang tanggal tidak valid.");
    }

    const span =
      (Date.parse(`${query.to}T00:00:00Z`) - Date.parse(`${query.from}T00:00:00Z`)) / 86_400_000;
    if (span > MAX_WINDOW_DAYS) {
      throw ValidationError(`Rentang tanggal maksimal ${MAX_WINDOW_DAYS} hari.`);
    }

    return deps.rentals.listOverlapping(query.from, query.to);
  };
}

export function makeGetRental(deps: { rentals: RentalRepository }) {
  return async function getRental(_actor: Actor, id: string): Promise<Rental> {
    const rental = await deps.rentals.findById(id);
    if (!rental) throw NotFoundError("Jadwal rental tidak ditemukan.");
    return rental;
  };
}

type WriteDeps = {
  rentals: RentalRepository;
  chat: ChatNotifier;
  clock: Clock;
  ids: IdGenerator;
  /** Where the console lives, for the link in the Telegram message. */
  consoleBaseUrl: string;
};

export function makeCreateRental(deps: WriteDeps) {
  return async function createRental(actor: Actor, details: RentalDetails): Promise<Rental> {
    const now = deps.clock.now();

    const rental: Rental = {
      ...withDerivedFields(details),
      id: deps.ids.generate(),
      paidAt: isPaid(details) ? now : null,
      reminders: EMPTY_LEDGER,
      createdAt: now,
      createdBy: actor.name,
      updatedAt: now,
    };

    await deps.rentals.create(rental);

    // A side effect of a save that already succeeded: the adapter never throws,
    // and the console must not show an error for an entry that is in the table.
    await deps.chat.send(rentalCreatedMessage(rental, deps.consoleBaseUrl));

    return rental;
  };
}

export function makeUpdateRental(deps: WriteDeps) {
  return async function updateRental(
    _actor: Actor,
    id: string,
    details: RentalDetails,
  ): Promise<Rental> {
    const existing = await deps.rentals.findById(id);
    if (!existing) throw NotFoundError("Jadwal rental tidak ditemukan.");

    const now = deps.clock.now();
    const becamePaid = !isPaid(existing) && isPaid(details);

    const rental: Rental = {
      ...existing,
      ...withDerivedFields(details),
      /*
       * `paidAt` records the first time the entry was marked paid. Flipping it
       * back to unpaid clears it so the next payment is dated correctly; a
       * paid → paid edit leaves it alone.
       */
      paidAt: isPaid(details) ? (existing.paidAt ?? now) : null,
      /*
       * Moving the dates resets the reminders for them: a pick-up pushed a
       * week out should get its H-1 nudge again, not be treated as already
       * announced. The overdue nudge is date-scoped anyway and repeats daily.
       */
      reminders: {
        pickupSentOn:
          details.startDate === existing.startDate ? existing.reminders.pickupSentOn : null,
        returnSentOn:
          withDerivedFields(details).endDate === existing.endDate
            ? existing.reminders.returnSentOn
            : null,
        overdueSentOn: existing.reminders.overdueSentOn,
      },
      updatedAt: now,
    };

    await deps.rentals.replace(rental);

    if (becamePaid) {
      await deps.chat.send(rentalPaidMessage(rental, deps.consoleBaseUrl));
    }

    return rental;
  };
}

export function makeDeleteRental(deps: { rentals: RentalRepository }) {
  return async function deleteRental(_actor: Actor, id: string): Promise<void> {
    const existing = await deps.rentals.findById(id);
    if (!existing) throw NotFoundError("Jadwal rental tidak ditemukan.");
    await deps.rentals.remove(id);
  };
}
