import { Hono } from "hono";

import { container } from "../../infrastructure/container.js";
import { authenticate, type AppEnv } from "../middleware.js";

export const notificationRoutes = new Hono<AppEnv>();

notificationRoutes.use("*", authenticate);

notificationRoutes.get("/", async (context) =>
  context.json({ items: await container.listNotifications(context.get("actor").id) }),
);

/**
 * Polled by the bell every few seconds while the console is open, so it stays a
 * `COUNT` query against a sparse index — no items are read or serialised.
 */
notificationRoutes.get("/unread-count", async (context) =>
  context.json(await container.countUnread(context.get("actor").id)),
);

notificationRoutes.post("/read-all", async (context) => {
  await container.markAllNotificationsRead(context.get("actor").id);
  return context.body(null, 204);
});

notificationRoutes.post("/:id/read", async (context) => {
  await container.markNotificationRead(context.get("actor").id, context.req.param("id"));
  return context.body(null, 204);
});
