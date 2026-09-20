/**
 * The Telegram texts for the rental group, kept apart from the use cases so
 * they can be read (and tested) as prose.
 *
 * Telegram renders a small HTML subset; anything the operator typed is escaped
 * so a `<` in a name cannot break the message or inject markup.
 */

import {
  isPaid,
  PAYMENT_STATUS_LABELS,
  rentalTotal,
  type Rental,
} from "../../domain/rental/rental.js";
import { formatDateID, formatRupiah } from "../../domain/shared/dates.js";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unit(rental: Rental): string {
  const plate = rental.plateNumber ? ` · ${escapeHtml(rental.plateNumber)}` : "";
  return `${escapeHtml(rental.vehicleLabel)}${plate}`;
}

function period(rental: Rental): string {
  const start = formatDateID(rental.startDate);
  if (rental.durationDays === 1) return `${start} · 1 hari`;
  return `${start} – ${formatDateID(rental.endDate)} · ${rental.durationDays} hari`;
}

function paymentLine(rental: Rental): string {
  if (isPaid(rental)) return `💰 ${formatRupiah(rentalTotal(rental))} · ✅ ${PAYMENT_STATUS_LABELS.sudah_dibayar}`;
  return `💰 ${formatRupiah(rentalTotal(rental))} · ⏳ ${PAYMENT_STATUS_LABELS.belum_dibayar}, jatuh tempo ${formatDateID(rental.paymentDueDate)}`;
}

function consoleLink(consoleBaseUrl: string, rental: Rental): string {
  return `<a href="${consoleBaseUrl}/admin/rental/?id=${rental.id}">Buka di konsol admin</a>`;
}

/** Sent the moment the operator saves a new entry. */
export function rentalCreatedMessage(rental: Rental, consoleBaseUrl: string): string {
  return [
    "🆕 <b>Jadwal Rental Baru</b>",
    "",
    `👤 <b>${escapeHtml(rental.customerName)}</b> · ${escapeHtml(rental.customerPhone)}`,
    `🚙 ${unit(rental)}`,
    `📅 ${period(rental)}, ambil ${escapeHtml(rental.startTime)} WIB`,
    paymentLine(rental),
    rental.notes ? `📝 ${escapeHtml(rental.notes)}` : null,
    "",
    `Dicatat oleh ${escapeHtml(rental.createdBy)}.`,
    consoleLink(consoleBaseUrl, rental),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Sent when an entry flips from unpaid to paid. */
export function rentalPaidMessage(rental: Rental, consoleBaseUrl: string): string {
  return [
    "✅ <b>Pembayaran Diterima</b>",
    "",
    `👤 <b>${escapeHtml(rental.customerName)}</b>`,
    `🚙 ${unit(rental)}`,
    `📅 ${period(rental)}`,
    `💰 ${formatRupiah(rentalTotal(rental))}`,
    "",
    consoleLink(consoleBaseUrl, rental),
  ].join("\n");
}

function digestEntry(rental: Rental, detail: string): string {
  return [
    `• <b>${escapeHtml(rental.customerName)}</b> · ${escapeHtml(rental.customerPhone)}`,
    `  🚙 ${unit(rental)}`,
    `  ${detail}`,
  ].join("\n");
}

/** Tomorrow's pick-ups, one message, so the crew sees the whole morning at once. */
export function pickupReminderMessage(
  rentals: Rental[],
  tomorrow: string,
  consoleBaseUrl: string,
): string {
  const lines = rentals.map((rental) =>
    digestEntry(
      rental,
      `🕘 Ambil ${escapeHtml(rental.startTime)} WIB · ${rental.durationDays} hari · ${
        isPaid(rental) ? "✅ Sudah dibayar" : "⏳ Belum dibayar"
      }`,
    ),
  );

  return [
    `🚗 <b>Besok ${rentals.length} unit keluar</b> — ${formatDateID(tomorrow)}`,
    "Siapkan mobilnya hari ini.",
    "",
    lines.join("\n\n"),
    "",
    `<a href="${consoleBaseUrl}/admin/rental/">Buka jadwal di konsol admin</a>`,
  ].join("\n");
}

/** Tomorrow's returns. */
export function returnReminderMessage(
  rentals: Rental[],
  tomorrow: string,
  consoleBaseUrl: string,
): string {
  const lines = rentals.map((rental) =>
    digestEntry(
      rental,
      `🔁 Masa sewa berakhir besok · mulai ${formatDateID(rental.startDate)} (${rental.durationDays} hari)`,
    ),
  );

  return [
    `🔁 <b>Besok ${rentals.length} unit kembali</b> — ${formatDateID(tomorrow)}`,
    "Hubungi penyewa untuk memastikan jam pengembalian.",
    "",
    lines.join("\n\n"),
    "",
    `<a href="${consoleBaseUrl}/admin/rental/">Buka jadwal di konsol admin</a>`,
  ].join("\n");
}

/** Unpaid rentals past their due date. Repeats daily until they are paid. */
export function overdueReminderMessage(
  rentals: Rental[],
  today: string,
  consoleBaseUrl: string,
): string {
  const lines = rentals.map((rental) =>
    digestEntry(
      rental,
      `⚠️ ${formatRupiah(rentalTotal(rental))} · jatuh tempo ${formatDateID(
        rental.paymentDueDate,
      )} · sewa ${formatDateID(rental.startDate)}`,
    ),
  );

  return [
    `⚠️ <b>${rentals.length} pembayaran lewat jatuh tempo</b> — per ${formatDateID(today)}`,
    "Tagih penyewa, lalu tandai lunas di konsol agar pengingat ini berhenti.",
    "",
    lines.join("\n\n"),
    "",
    `<a href="${consoleBaseUrl}/admin/rental/?bayar=belum">Buka daftar di konsol admin</a>`,
  ].join("\n");
}
