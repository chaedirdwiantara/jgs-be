import { z } from "zod";

import { DOCUMENT_SLOT_KEYS } from "../domain/application/rental-application.js";
import { APPLICATION_STATUSES } from "../domain/application/rental-application.js";
import { USER_ROLES } from "../domain/user/user.js";
import { VEHICLE_TIERS } from "../domain/vehicle/vehicle.js";

/**
 * Request shapes. Messages are in Indonesian because they are shown verbatim in
 * the form — the client does not translate anything the API says.
 */

/** `08…`, `+628…` and `628…` all normalise to `628…`. */
export function normalisePhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  return digits;
}

const phone = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} wajib diisi`)
    .transform(normalisePhone)
    .refine(
      (value) => /^62\d{8,13}$/.test(value),
      `${label} tidak valid. Contoh: 0811803090`,
    );

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} wajib diisi` : `${label} minimal ${min} karakter`)
    .max(max, `${label} maksimal ${max} karakter`);

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi").pipe(z.email("Format email tidak valid")),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});

/**
 * Twelve characters, no composition rules.
 *
 * Length is what actually resists guessing; mandatory symbols mostly produce
 * `Password1!` and a sticky note. NIST SP 800-63B says the same.
 */
const password = z
  .string()
  .min(12, "Kata sandi minimal 12 karakter")
  .max(200, "Kata sandi maksimal 200 karakter");

export const createUserSchema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi").pipe(z.email("Format email tidak valid")),
  name: text("Nama", 2, 80),
  role: z.enum(USER_ROLES, { error: "Pilih peran pengguna" }),
  password,
});

export const updateUserSchema = z
  .object({
    name: text("Nama", 2, 80).optional(),
    role: z.enum(USER_ROLES).optional(),
    isActive: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Tidak ada perubahan yang dikirim");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Kata sandi saat ini wajib diisi"),
  newPassword: password,
});

export const uploadTicketSchema = z.object({
  slot: z.enum(DOCUMENT_SLOT_KEYS as unknown as [string, ...string[]], {
    error: "Jenis dokumen tidak dikenal",
  }),
  contentType: z.string().trim().min(1, "Tipe berkas wajib diisi"),
});

/** `YYYY-MM-DD`, and a date that actually exists (not 2026-02-31). */
const calendarDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal penyewaan wajib diisi")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, "Tanggal penyewaan tidak valid");

/**
 * `partialRecord`, not `record`.
 *
 * In Zod 4 a `record()` keyed by an enum is **exhaustive** — it demands every
 * member. Two of the seven document slots are optional, so `record()` rejected
 * every real submission with "expected string, received undefined" for the
 * slots the renter legitimately skipped.
 */
const documentMap = z.partialRecord(
  z.enum(DOCUMENT_SLOT_KEYS as unknown as [string, ...string[]]),
  z.string().trim().min(1).max(300),
);

export const submitApplicationSchema = z
  .object({
    email: z.string().trim().min(1, "Email wajib diisi").pipe(z.email("Format email tidak valid")),
    fullName: text("Nama lengkap", 2, 120),
    address: text("Alamat tinggal", 5, 400),
    whatsapp: phone("Nomor WhatsApp"),
    gsmNumber: phone("Nomor GSM"),
    emergencyNumber: phone("Nomor darurat"),

    purpose: text("Tujuan menyewa mobil", 2, 300),
    usageLocation: text("Lokasi penggunaan mobil", 2, 300),
    startDate: calendarDate,
    startTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam mulai sewa wajib diisi"),
    durationDays: z.coerce
      .number({ error: "Durasi penyewaan wajib diisi" })
      .int("Durasi penyewaan harus berupa angka bulat")
      .min(1, "Durasi penyewaan minimal 1 hari")
      .max(90, "Durasi penyewaan maksimal 90 hari"),

    vehicleChoice: text("Jenis mobil", 1, 60),
    vehicleOther: z.string().trim().max(80, "Maksimal 80 karakter").nullish(),
    withDriver: z.boolean({ error: "Pilih dengan atau tanpa driver" }),

    referralSource: text("Sumber informasi", 1, 60),
    referralSourceOther: z.string().trim().max(80, "Maksimal 80 karakter").nullish(),

    documentKeys: documentMap,
    documentNames: documentMap.optional(),

    /**
     * Anti-spam honeypot: hidden from people, irresistible to bots.
     *
     * Deliberately permissive. Rejecting a filled value here would answer the
     * bot with a 422 naming the field, which is exactly the feedback it needs
     * to learn to skip it. The route accepts the request and quietly drops it
     * instead — see `routes/applications.ts`.
     */
    website: z.string().max(200).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.vehicleChoice === OTHER_OPTION && !value.vehicleOther) {
      ctx.addIssue({
        code: "custom",
        path: ["vehicleOther"],
        message: "Tuliskan jenis mobil yang Anda inginkan",
      });
    }
    if (value.referralSource === OTHER_OPTION && !value.referralSourceOther) {
      ctx.addIssue({
        code: "custom",
        path: ["referralSourceOther"],
        message: "Tuliskan dari mana Anda mengetahui JGS",
      });
    }
  });

/** The sentinel both "Jenis Mobil" and "Darimana…" use for their free-text option. */
export const OTHER_OPTION = "lainnya";

export const updateApplicationSchema = z
  .object({
    status: z.enum(APPLICATION_STATUSES).optional(),
    internalNote: z.string().trim().max(2000, "Catatan maksimal 2000 karakter").optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Tidak ada perubahan yang dikirim");

export const listApplicationsSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

const photoPath = z
  .string()
  .trim()
  .min(1, "Alamat foto wajib diisi")
  .max(500, "Alamat foto terlalu panjang")
  .refine(
    (value) => value.startsWith("/") || /^https:\/\/\S+$/.test(value),
    "Gunakan path yang diawali / atau URL https://",
  );

const rupiah = (label: string, max: number) =>
  z
    .number({ error: `${label} wajib diisi` })
    .int(`${label} harus berupa angka bulat`)
    .min(0, `${label} tidak boleh negatif`)
    .max(max, `${label} melebihi batas wajar`);

/** Mirrors `src/features/admin/schema.ts` in the console, field for field. */
export const vehicleSchema = z.object({
  id: z
    .string()
    .trim()
    .min(2, "Kode unit minimal 2 karakter")
    .max(40, "Kode unit maksimal 40 karakter")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Gunakan huruf kecil, angka, dan tanda hubung. Contoh: byd-seal",
    ),
  name: text("Nama mobil", 2, 60),
  tier: z.enum(VEHICLE_TIERS, { error: "Pilih kelas armada" }),
  seats: z.number().int().min(1).max(12),
  luggage: z.number().int().min(0).max(12),
  rangeKm: z.number().int().min(50).max(1500),
  dailyRate: rupiah("Tarif harian", 100_000_000),
  monthlyRate: rupiah("Tarif bulanan", 1_000_000_000),
  downtimeRate: rupiah("Biaya downtime", 100_000_000),
  highlights: z
    .array(z.string().trim().min(1).max(80))
    .min(1, "Isi minimal satu keunggulan")
    .max(5, "Maksimal 5 keunggulan"),
  photos: z.object({
    outdoor: z.object({ wide: photoPath, tall: photoPath }),
    studio: z.object({ wide: photoPath, tall: photoPath }),
  }),
});
