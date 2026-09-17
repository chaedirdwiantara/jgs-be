import type {
  ApplicationPage,
  ApplicationRepository,
  ListApplicationsQuery,
} from "../../domain/application/application-repository.js";
import {
  APPLICATION_STATUSES,
  type ApplicationStatus,
  type DocumentSlot,
  type RentalApplication,
} from "../../domain/application/rental-application.js";
import { ForbiddenError, NotFoundError } from "../../domain/shared/errors.js";
import type { Clock } from "../../domain/shared/ports.js";
import type { DocumentStorage } from "../../domain/storage/document-storage.js";
import type { User } from "../../domain/user/user.js";

export type Actor = Pick<User, "id" | "name" | "role">;

/**
 * Long enough for an operator to open every document in a submission, short
 * enough that a URL copied into a chat stops working the same afternoon.
 */
const DOCUMENT_URL_TTL_SECONDS = 15 * 60;

export function makeListApplications(deps: { applications: ApplicationRepository }) {
  return async function listApplications(
    _actor: Actor,
    query: ListApplicationsQuery,
  ): Promise<ApplicationPage> {
    return deps.applications.list(query);
  };
}

export function makeCountApplications(deps: { applications: ApplicationRepository }) {
  return async function countApplications(
    _actor: Actor,
  ): Promise<Record<ApplicationStatus, number>> {
    return deps.applications.countByStatus();
  };
}

/** The detail view: the full record, with a signed URL per attached document. */
export type ApplicationDetail = Omit<RentalApplication, "documents"> & {
  documents: Array<{
    slot: DocumentSlot;
    url: string;
    contentType: string;
    sizeBytes: number;
    originalName: string;
  }>;
};

export function makeGetApplication(deps: {
  applications: ApplicationRepository;
  storage: DocumentStorage;
}) {
  return async function getApplication(_actor: Actor, id: string): Promise<ApplicationDetail> {
    const application = await deps.applications.findById(id);
    if (!application) throw NotFoundError("Pengajuan tidak ditemukan.");

    const entries = Object.entries(application.documents) as Array<
      [DocumentSlot, NonNullable<RentalApplication["documents"][DocumentSlot]>]
    >;

    const documents = await Promise.all(
      entries.map(async ([slot, document]) => ({
        slot,
        url: await deps.storage.createDownloadUrl(document.key, DOCUMENT_URL_TTL_SECONDS),
        contentType: document.contentType,
        sizeBytes: document.sizeBytes,
        originalName: document.originalName,
      })),
    );

    const { documents: _raw, ...rest } = application;
    return { ...rest, documents };
  };
}

export type UpdateApplicationCommand = {
  status?: ApplicationStatus;
  internalNote?: string;
};

export function makeUpdateApplication(deps: {
  applications: ApplicationRepository;
  clock: Clock;
}) {
  return async function updateApplication(
    actor: Actor,
    id: string,
    command: UpdateApplicationCommand,
  ): Promise<void> {
    const application = await deps.applications.findById(id);
    if (!application) throw NotFoundError("Pengajuan tidak ditemukan.");

    const now = deps.clock.now();
    const patch: Partial<RentalApplication> = { updatedAt: now };

    if (command.internalNote !== undefined) patch.internalNote = command.internalNote;

    if (command.status !== undefined && command.status !== application.status) {
      patch.status = command.status;

      /*
       * `reviewedAt` records the first time a human moved this off the inbox,
       * so later status changes must not overwrite it.
       */
      if (application.status === "baru" && application.reviewedAt === null) {
        patch.reviewedAt = now;
        patch.reviewedBy = actor.name;
      }
    }

    await deps.applications.update(id, patch);
  };
}

/**
 * Deleting is restricted to the owner and takes the identity photos with it —
 * a rejected application is personal data we have no reason to keep.
 */
export function makeDeleteApplication(deps: {
  applications: ApplicationRepository;
  storage: DocumentStorage;
}) {
  return async function deleteApplication(actor: Actor, id: string): Promise<void> {
    if (actor.role !== "owner") {
      throw ForbiddenError("Hanya Pemilik yang dapat menghapus pengajuan.");
    }

    const application = await deps.applications.findById(id);
    if (!application) throw NotFoundError("Pengajuan tidak ditemukan.");

    await deps.applications.remove(id);
    await deps.storage.remove(
      Object.values(application.documents).map((document) => document.key),
    );
  };
}

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}
