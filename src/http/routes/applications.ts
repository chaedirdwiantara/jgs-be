import { Hono } from "hono";

import type { DocumentSlot } from "../../domain/application/rental-application.js";
import { container } from "../../infrastructure/container.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { authenticate, clientIp, parseBody, type AppEnv } from "../middleware.js";
import {
  listApplicationsSchema,
  submitApplicationSchema,
  updateApplicationSchema,
  uploadTicketSchema,
} from "../schemas.js";

export const applicationRoutes = new Hono<AppEnv>();

/* ── Public: the rental form at /formulir ─────────────────────────────────── */

/**
 * Hands out one upload ticket per photo. Public, because the form is — abuse is
 * held down by the per-IP limiter, the content-type allow-list, and the size
 * ceiling baked into the ticket policy.
 */
applicationRoutes.post("/uploads", async (context) => {
  const body = parseBody(uploadTicketSchema, await context.req.json().catch(() => ({})));

  const ticket = await container.createUploadTicket({
    slot: body.slot,
    contentType: body.contentType,
    clientIp: clientIp(context),
  });

  return context.json(ticket, 201);
});

applicationRoutes.post("/applications", async (context) => {
  const body = parseBody(submitApplicationSchema, await context.req.json().catch(() => ({})));

  /*
   * Honeypot tripped. Answering with a plausible success — rather than an
   * error — denies the bot the signal it needs to adapt, and a real person can
   * never reach this branch because the field is hidden from them.
   */
  if (body.website) {
    logger.info("application_honeypot_tripped", { ip: clientIp(context) });
    return context.json({ id: "", referenceCode: "JGS-000000-0000" }, 201);
  }

  const result = await container.submitApplication({
    email: body.email,
    fullName: body.fullName,
    address: body.address,
    whatsapp: body.whatsapp,
    gsmNumber: body.gsmNumber,
    emergencyNumber: body.emergencyNumber,
    purpose: body.purpose,
    usageLocation: body.usageLocation,
    startDate: body.startDate,
    startTime: body.startTime,
    durationDays: body.durationDays,
    vehicleChoice: body.vehicleChoice,
    vehicleOther: body.vehicleOther ?? null,
    withDriver: body.withDriver,
    referralSource: body.referralSource,
    referralSourceOther: body.referralSourceOther ?? null,
    documentKeys: body.documentKeys as Partial<Record<DocumentSlot, string>>,
    documentNames: (body.documentNames ?? {}) as Partial<Record<DocumentSlot, string>>,
    clientIp: clientIp(context),
  });

  logger.info("application_submitted", { id: result.id, reference: result.referenceCode });

  return context.json(result, 201);
});

/* ── Console: everything below needs a session ────────────────────────────── */

applicationRoutes.use("/applications/*", authenticate);

/** Declared before `/:id` so "summary" is not read as an application id. */
applicationRoutes.get("/applications/summary", async (context) =>
  context.json({ counts: await container.countApplications(context.get("actor")) }),
);

applicationRoutes.get("/applications", authenticate, async (context) => {
  const query = parseBody(listApplicationsSchema, context.req.query());
  return context.json(await container.listApplications(context.get("actor"), query));
});

applicationRoutes.get("/applications/:id", async (context) =>
  context.json({
    application: await container.getApplication(context.get("actor"), context.req.param("id")),
  }),
);

applicationRoutes.patch("/applications/:id", async (context) => {
  const body = parseBody(updateApplicationSchema, await context.req.json().catch(() => ({})));
  await container.updateApplication(context.get("actor"), context.req.param("id"), body);
  return context.body(null, 204);
});

applicationRoutes.delete("/applications/:id", async (context) => {
  await container.deleteApplication(context.get("actor"), context.req.param("id"));
  return context.body(null, 204);
});
