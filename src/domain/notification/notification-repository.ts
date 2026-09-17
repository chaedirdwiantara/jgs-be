import type { Notification } from "./notification.js";

export interface NotificationRepository {
  /** Newest first, capped at `limit`. */
  listForUser(userId: string, limit: number): Promise<Notification[]>;
  countUnread(userId: string): Promise<number>;
  /** One record per recipient, written in a single batch. */
  createMany(notifications: Notification[]): Promise<void>;
  markRead(userId: string, notificationId: string, readAt: string): Promise<void>;
  markAllRead(userId: string, readAt: string): Promise<void>;
}
