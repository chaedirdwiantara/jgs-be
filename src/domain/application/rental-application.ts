/**
 * A rental application: what a prospective renter submits from the public form
 * at `/formulir`, and what the console's inbox works through.
 *
 * The field set mirrors the operator's existing intake form one-for-one. Do not
 * add or drop fields here without the operator agreeing — this is their process,
 * not a modelling exercise.
 */

export const APPLICATION_STATUSES = ["baru", "diproses", "disetujui", "ditolak"] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  baru: "Baru",
  diproses: "Diproses",
  disetujui: "Disetujui",
  ditolak: "Ditolak",
};

/**
 * The six photo slots on the intake form, in the order they are asked for.
 *
 * `camera` drives the capture hint the browser gets on a phone: the selfie uses
 * the front lens, every other slot the rear one.
 */
export const DOCUMENT_SLOTS = [
  { key: "ktp", label: "Foto KTP", required: true, camera: "environment" },
  { key: "selfieKtp", label: "Foto Selfie dengan KTP", required: true, camera: "user" },
  { key: "sim", label: "Foto SIM", required: true, camera: "environment" },
  { key: "kartuKeluarga", label: "Foto Kartu Keluarga", required: true, camera: "environment" },
  {
    key: "tokenListrik",
    label: "Foto Nomor Token Rumah",
    required: false,
    camera: "environment",
  },
  {
    key: "riwayatAkun",
    label: "Foto History & Profil Akun Grab/GoCar/Maxim/Shopee/Tokopedia",
    required: false,
    camera: "environment",
  },
] as const;

/**
 * Slots the form no longer collects, but whose files still exist.
 *
 * `sosialMedia` was a screenshot of the renter's profile; it is now the
 * `socialPlatform` + `socialAccount` pair below, which the console can open as
 * a link. The key stays accepted here for two reasons: applications submitted
 * before the change still carry the file and must keep rendering, and a browser
 * left on the previous build must not have its submission rejected outright.
 */
export const LEGACY_DOCUMENT_SLOTS = [
  { key: "sosialMedia", label: "Akun Sosial Media IG/TikTok (unggahan lama)" },
] as const;

export type DocumentSlot =
  | (typeof DOCUMENT_SLOTS)[number]["key"]
  | (typeof LEGACY_DOCUMENT_SLOTS)[number]["key"];

/** Every key accepted on input, current and retired. */
export const DOCUMENT_SLOT_KEYS = [
  ...DOCUMENT_SLOTS.map((slot) => slot.key),
  ...LEGACY_DOCUMENT_SLOTS.map((slot) => slot.key),
] as readonly DocumentSlot[];

export const REQUIRED_DOCUMENT_SLOTS = DOCUMENT_SLOTS.filter((slot) => slot.required).map(
  (slot) => slot.key,
) as readonly DocumentSlot[];

/**
 * Where the renter's social account lives. `lainnya` is the escape hatch for
 * anything else, and is the one value the console cannot turn into a link from
 * a username alone.
 */
export const SOCIAL_PLATFORMS = ["instagram", "tiktok", "facebook", "lainnya"] as const;

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Where a submitted photo ended up, plus what it was when it arrived. */
export type StoredDocument = {
  /** S3 object key. Never exposed raw — the console reads it via a signed URL. */
  key: string;
  contentType: string;
  sizeBytes: number;
  originalName: string;
};

export type ApplicantDetails = {
  email: string;
  fullName: string;
  /** Free-text home address, as typed. */
  address: string;
  whatsapp: string;
  /** Second line the renter can be reached on, per the operator's form. */
  gsmNumber: string;
  /** Spouse or sibling, per the operator's form. */
  emergencyNumber: string;
  /**
   * The renter's social account, which the operator opens to verify they are a
   * real person. Stored as a pair — `instagram` + `budi.santoso` — rather than
   * one URL, because the form accepts a bare username and only the platform
   * says which profile root it hangs off.
   *
   * `socialPlatform` is `instagram` | `tiktok` | `facebook` | `lainnya`; under
   * `lainnya` the account is expected to be a full address.
   */
  socialPlatform: SocialPlatform;
  socialAccount: string;
};

export type RentalDetails = {
  purpose: string;
  usageLocation: string;
  /** `YYYY-MM-DD`, local (WIB) calendar date the rental starts. */
  startDate: string;
  /** `HH:mm`, 24-hour, WIB. */
  startTime: string;
  durationDays: number;
  /**
   * The unit the renter picked. `vehicleChoice` is the option value; when they
   * pick "lainnya" the free-text goes in `vehicleOther`.
   */
  vehicleChoice: string;
  /**
   * The unit's name exactly as the renter saw it ("IONIQ 5"), alongside the
   * stable slug above. Stored rather than derived: the API has no label table,
   * and an alert that reads "ioniq-5" looks unfinished to whoever it wakes up.
   */
  vehicleLabel: string;
  vehicleOther: string | null;
  withDriver: boolean;
  referralSource: string;
  referralSourceOther: string | null;
};

export type RentalApplication = ApplicantDetails &
  RentalDetails & {
    id: string;
    /** Short human-quotable id, e.g. `JGS-260917-4KQ2`. Unique per application. */
    referenceCode: string;
    status: ApplicationStatus;
    /** Console-only. Never shown to the applicant. */
    internalNote: string;
    documents: Partial<Record<DocumentSlot, StoredDocument>>;
    submittedAt: string;
    updatedAt: string;
    /** Set the first time the status moves off `baru`. */
    reviewedAt: string | null;
    reviewedBy: string | null;
  };

/** Listing projection — the inbox table never needs the documents or the note. */
export type ApplicationSummary = Pick<
  RentalApplication,
  | "id"
  | "referenceCode"
  | "fullName"
  | "whatsapp"
  | "vehicleChoice"
  | "vehicleLabel"
  | "vehicleOther"
  | "withDriver"
  | "startDate"
  | "durationDays"
  | "status"
  | "submittedAt"
>;

export function toSummary(application: RentalApplication): ApplicationSummary {
  return {
    id: application.id,
    referenceCode: application.referenceCode,
    fullName: application.fullName,
    whatsapp: application.whatsapp,
    vehicleChoice: application.vehicleChoice,
    vehicleLabel: application.vehicleLabel,
    vehicleOther: application.vehicleOther,
    withDriver: application.withDriver,
    startDate: application.startDate,
    durationDays: application.durationDays,
    status: application.status,
    submittedAt: application.submittedAt,
  };
}

/** What the renter actually gets: the free text when they chose "lainnya". */
export function resolvedVehicle(
  application: Pick<RentalApplication, "vehicleChoice" | "vehicleLabel" | "vehicleOther">,
): string {
  if (application.vehicleChoice === "lainnya" && application.vehicleOther) {
    return application.vehicleOther;
  }
  return application.vehicleLabel || application.vehicleChoice;
}

const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I — read aloud over the phone

/**
 * `JGS-YYMMDD-XXXX`. The date part makes it sortable by eye; the four random
 * characters keep two same-day applications apart.
 */
export function buildReferenceCode(nowIso: string, random: () => number): string {
  const date = new Date(nowIso);
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");

  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += REFERENCE_ALPHABET[Math.floor(random() * REFERENCE_ALPHABET.length)];
  }

  return `JGS-${yy}${mm}${dd}-${suffix}`;
}
