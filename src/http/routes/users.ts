import { Hono } from "hono";

import { container } from "../../infrastructure/container.js";
import { authenticate, parseBody, requireOwner, type AppEnv } from "../middleware.js";
import { createUserSchema, updateUserSchema } from "../schemas.js";

/** Every route here is owner-only; the guard is applied once, on the group. */
export const userRoutes = new Hono<AppEnv>();

userRoutes.use("*", authenticate, requireOwner);

userRoutes.get("/", async (context) =>
  context.json({ items: await container.listUsers(context.get("actor")) }),
);

userRoutes.post("/", async (context) => {
  const body = parseBody(createUserSchema, await context.req.json().catch(() => ({})));
  const user = await container.createUser(context.get("actor"), body);
  return context.json({ user }, 201);
});

userRoutes.patch("/:id", async (context) => {
  const body = parseBody(updateUserSchema, await context.req.json().catch(() => ({})));
  const user = await container.updateUser(context.get("actor"), context.req.param("id"), body);
  return context.json({ user });
});

userRoutes.delete("/:id", async (context) => {
  await container.deleteUser(context.get("actor"), context.req.param("id"));
  return context.body(null, 204);
});
