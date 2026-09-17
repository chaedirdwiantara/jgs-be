import { serve } from "@hono/node-server";

import { createApp } from "./http/app.js";

/**
 * Local development server. Talks to the real AWS resources named in `.env`,
 * so point it at the dev tables — there is no emulator in this setup.
 */
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`jgs-be listening on http://localhost:${info.port}`);
});
