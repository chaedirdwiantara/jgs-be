import type {
  ApplicationStatus,
  ApplicationSummary,
  RentalApplication,
} from "./rental-application.js";

export type ListApplicationsQuery = {
  /** Omit for "every status". */
  status?: ApplicationStatus;
  limit: number;
  /** Opaque cursor from the previous page. */
  cursor?: string;
};

export type ApplicationPage = {
  items: ApplicationSummary[];
  /** `null` when there is nothing after this page. */
  nextCursor: string | null;
};

export interface ApplicationRepository {
  /** Newest first. */
  list(query: ListApplicationsQuery): Promise<ApplicationPage>;
  findById(id: string): Promise<RentalApplication | null>;
  create(application: RentalApplication): Promise<void>;
  update(
    id: string,
    patch: Partial<Omit<RentalApplication, "id" | "referenceCode" | "submittedAt">>,
  ): Promise<void>;
  remove(id: string): Promise<void>;
  /** Inbox badge: how many sit in each status right now. */
  countByStatus(): Promise<Record<ApplicationStatus, number>>;
}
