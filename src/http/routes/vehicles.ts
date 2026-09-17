import { Hono } from "hono";

import { container } from "../../infrastructure/container.js";
import { authenticate, parseBody, type AppEnv } from "../middleware.js";
import { vehicleSchema } from "../schemas.js";

export const vehicleRoutes = new Hono<AppEnv>();

/** Public read: this is the same catalogue the marketing site publishes. */
vehicleRoutes.get("/", async (context) => context.json(await container.listVehicles()));

vehicleRoutes.post("/", authenticate, async (context) => {
  const body = parseBody(vehicleSchema, await context.req.json().catch(() => ({})));
  return context.json(await container.createVehicle(body), 201);
});

vehicleRoutes.put("/:id", authenticate, async (context) => {
  const body = parseBody(vehicleSchema, await context.req.json().catch(() => ({})));
  return context.json(await container.updateVehicle(context.req.param("id"), body));
});

vehicleRoutes.delete("/:id", authenticate, async (context) => {
  await container.deleteVehicle(context.req.param("id"));
  return context.body(null, 204);
});
