import { handle } from "hono/aws-lambda";

import { createApp } from "./http/app.js";

/**
 * Lambda entry point.
 *
 * The app is built at module load so every SDK client, and the config parse
 * that can reject a bad deploy, happens during the init phase rather than on
 * the first request.
 */
export const handler = handle(createApp());
