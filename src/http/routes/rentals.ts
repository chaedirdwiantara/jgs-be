import { Hono } from "hono";

import { container } from "../../infrastructure/container.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { authenticate, parseBody, type AppEnv } from "../middleware.js";
import { listRentalsSchema, rentalSchema } from "../schemas.js";

/**
 * The rental schedule. Console-only: every route needs a session, and any
 * signed-in operator may write — a wrong date on the board is fixed by whoever
 * spots it, and unlike an application there are no identity documents here
 * to justify restricting deletion to the owner.
 */
export const rentalRoutes = new Hono<AppEnv>();

rentalRoutes.use("*", authenticate);

rentalRoutes.get("/", async (context) => {
  const query = parseBody(listRentalsSchema, context.req.query());
  return context.json({ items: await container.listRentals(context.get("actor"), query) });
});

rentalRoutes.get("/:id", async (context) =>
  context.json({ rental: await container.getRental(context.get("actor"), context.req.param("id")) }),
);

rentalRoutes.post("/", async (context) => {
  const body = parseBody(rentalSchema, await context.req.json().catch(() => ({})));
  const rental = await container.createRental(context.get("actor"), body);
  logger.info("rental_created", { id: rental.id, startDate: rental.startDate });
  return context.json({ rental }, 201);
});

rentalRoutes.put("/:id", async (context) => {
  const body = parseBody(rentalSchema, await context.req.json().catch(() => ({})));
  const rental = await container.updateRental(context.get("actor"), context.req.param("id"), body);
  return context.json({ rental });
});

rentalRoutes.delete("/:id", async (context) => {
  await container.deleteRental(context.get("actor"), context.req.param("id"));
  return context.body(null, 204);
});
