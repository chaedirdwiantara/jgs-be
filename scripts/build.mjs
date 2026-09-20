import { rm, mkdir } from "node:fs/promises";

import { build } from "esbuild";

/**
 * Bundles each Lambda entry point into its own CommonJS file under `dist/`.
 *
 * Two functions, one bundle directory: `index.js` serves HTTP and
 * `scheduler.js` runs the daily reminders. They are packaged as one artifact
 * because they share the container — deploying them separately is how the API
 * and the job end up disagreeing about what a rental looks like.
 *
 * Everything is bundled, including the AWS SDK: the Node.js 22 runtime no
 * longer ships it, so relying on the runtime's copy (as was safe on Node 18)
 * would fail at import time.
 */
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: { index: "src/lambda.ts", scheduler: "src/scheduler.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  // Keeps CloudWatch stack traces pointing at real source lines.
  sourcemap: "linked",
  legalComments: "none",
  logLevel: "info",
});

// `dist/` is what `aws cloudformation package` uploads as the function's code,
// so nothing else may live in it.
console.log("Built dist/index.js and dist/scheduler.js");
