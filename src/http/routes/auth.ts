import { Hono } from "hono";

import { container } from "../../infrastructure/container.js";
import { authenticate, clientIp, parseBody, type AppEnv } from "../middleware.js";
import { changePasswordSchema, loginSchema } from "../schemas.js";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (context) => {
  const body = parseBody(loginSchema, await context.req.json().catch(() => ({})));

  const result = await container.login({ ...body, clientIp: clientIp(context) });

  // `token` is the name the console's `auth-service.ts` reads first.
  return context.json({
    token: result.token,
    expiresAt: result.expiresAt,
    user: result.user,
  });
});

authRoutes.get("/me", authenticate, (context) => context.json({ user: context.get("actor") }));

authRoutes.post("/password", authenticate, async (context) => {
  const body = parseBody(changePasswordSchema, await context.req.json().catch(() => ({})));

  await container.changeOwnPassword(context.get("actor"), body);

  return context.body(null, 204);
});
