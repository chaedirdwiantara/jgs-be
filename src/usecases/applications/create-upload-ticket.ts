import {
  DOCUMENT_SLOT_KEYS,
  type DocumentSlot,
} from "../../domain/application/rental-application.js";
import { RateLimitedError, ValidationError } from "../../domain/shared/errors.js";
import type { IdGenerator, RateLimiter } from "../../domain/shared/ports.js";
import type { DocumentStorage, UploadTicket } from "../../domain/storage/document-storage.js";

/**
 * Accepted uploads. Phone cameras produce JPEG (or HEIC on iOS); scans and
 * screenshots arrive as PNG or PDF. Anything else is rejected by the storage
 * service itself, not just by us — the ticket's policy pins the content type.
 */
const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
};

/** Comfortably above a 12 MP phone photo, far below anything worth hosting. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const TICKET_TTL_SECONDS = 10 * 60;

/** Seven slots per application, plus room to retake a blurry shot. */
const MAX_TICKETS_PER_IP = 60;
const TICKET_WINDOW_SECONDS = 60 * 60;

export type CreateUploadTicketCommand = {
  slot: string;
  contentType: string;
  clientIp: string;
};

export function makeCreateUploadTicket(deps: {
  storage: DocumentStorage;
  ids: IdGenerator;
  rateLimiter: RateLimiter;
}) {
  return async function createUploadTicket(
    command: CreateUploadTicketCommand,
  ): Promise<UploadTicket & { maxBytes: number }> {
    const { allowed } = await deps.rateLimiter.hit(
      `upload:ip:${command.clientIp}`,
      MAX_TICKETS_PER_IP,
      TICKET_WINDOW_SECONDS,
    );
    if (!allowed) throw RateLimitedError();

    if (!isDocumentSlot(command.slot)) {
      throw ValidationError("Jenis dokumen tidak dikenal.", { slot: "Jenis dokumen tidak dikenal." });
    }

    const extension = ALLOWED_TYPES[command.contentType];
    if (!extension) {
      throw ValidationError("Format berkas tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.", {
        [command.slot]: "Format berkas tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF.",
      });
    }

    /*
     * The server owns the whole key. If the browser could choose it, one
     * visitor could overwrite another visitor's staged upload by guessing.
     */
    const key = `uploads/${deps.ids.generate()}/${command.slot}${extension}`;

    const ticket = await deps.storage.createUploadTicket({
      key,
      contentType: command.contentType,
      maxBytes: MAX_UPLOAD_BYTES,
      expiresInSeconds: TICKET_TTL_SECONDS,
    });

    return { ...ticket, maxBytes: MAX_UPLOAD_BYTES };
  };
}

function isDocumentSlot(value: string): value is DocumentSlot {
  return (DOCUMENT_SLOT_KEYS as readonly string[]).includes(value);
}
