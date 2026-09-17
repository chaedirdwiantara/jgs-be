import type { Notification } from "../../domain/notification/notification.js";
import type { NotificationRepository } from "../../domain/notification/notification-repository.js";
import type { Clock } from "../../domain/shared/ports.js";

type Deps = { notifications: NotificationRepository; clock: Clock };

/** The bell's dropdown never needs more than this. */
const FEED_LIMIT = 30;

export function makeListNotifications(deps: Pick<Deps, "notifications">) {
  return async function listNotifications(userId: string): Promise<Notification[]> {
    return deps.notifications.listForUser(userId, FEED_LIMIT);
  };
}

/** The polled endpoint — kept to a single counting query, no item payload. */
export function makeCountUnread(deps: Pick<Deps, "notifications">) {
  return async function countUnread(userId: string): Promise<{ unread: number }> {
    return { unread: await deps.notifications.countUnread(userId) };
  };
}

export function makeMarkNotificationRead(deps: Deps) {
  return async function markNotificationRead(userId: string, id: string): Promise<void> {
    await deps.notifications.markRead(userId, id, deps.clock.now());
  };
}

export function makeMarkAllNotificationsRead(deps: Deps) {
  return async function markAllNotificationsRead(userId: string): Promise<void> {
    await deps.notifications.markAllRead(userId, deps.clock.now());
  };
}
