import { randomUUID } from "node:crypto";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";

import { corsOrigins, env } from "../config/env.js";
import { logger } from "../infrastructure/logging/logger.js";
import { errorResponse, type AppEnv } from "./middleware.js";
import { applicationRoutes } from "./routes/applications.js";
import { authRoutes } from "./routes/auth.js";
import { notificationRoutes } from "./routes/notifications.js";
import { rentalRoutes } from "./routes/rentals.js";
import { userRoutes } from "./routes/users.js";
import { vehicleRoutes } from "./routes/vehicles.js";

export function createApp() {
  const app = new Hono<AppEnv>();

  app.use("*", async (context, next) => {
    context.set("requestId", randomUUID());
    await next();
  });

  app.use("*", secureHeaders());

  /*
   * An explicit allow-list, never a reflected origin. The console sends a
   * bearer token, so a permissive CORS policy would let any page a signed-in
   * operator visits drive this API as them.
   */
  app.use(
    "*",
    cors({
      origin: (origin) => (corsOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      // Not a CORS-safelisted header; without this the form cannot read it.
      exposeHeaders: ["Retry-After"],
      maxAge: 86_400,
    }),
  );

  app.get("/health", (context) =>
    context.json({ status: "ok", environment: env.NODE_ENV, time: new Date().toISOString() }),
  );

  app.route("/auth", authRoutes);
  app.route("/users", userRoutes);
  app.route("/vehicles", vehicleRoutes);
  app.route("/notifications", notificationRoutes);
  app.route("/rentals", rentalRoutes);
  // Owns two prefixes (`/uploads` and `/applications`) because they are one
  // feature: a form upload only exists to be attached to a submission.
  app.route("/", applicationRoutes);

  app.notFound((context) => context.json({ message: "Endpoint tidak ditemukan." }, 404));

  app.onError((cause, context) => errorResponse(context, cause));

  logger.info("app_ready", { environment: env.NODE_ENV, origins: corsOrigins.length });

  return app;
}
