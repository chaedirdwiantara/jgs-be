/**
 * Console bell notifications.
 *
 * One record per recipient rather than one shared record: read state is
 * per-person, so a colleague opening the bell must not clear it for everyone.
 * The audience is a handful of staff, so the fan-out on write is a few puts.
 */

export const NOTIFICATION_TYPES = ["application.submitted"] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type Notification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** Where the bell should take the operator. Site-relative. */
  href: string;
  createdAt: string;
  readAt: string | null;
};
