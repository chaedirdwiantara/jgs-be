import { rm, mkdir } from "node:fs/promises";

import { build } from "esbuild";

/**
 * Bundles the Lambda into a single CommonJS file and zips it.
 *
 * Everything is bundled, including the AWS SDK: the Node.js 22 runtime no
 * longer ships it, so relying on the runtime's copy (as was safe on Node 18)
 * would fail at import time.
 */
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await build({
  entryPoints: ["src/lambda.ts"],
  outfile: "dist/index.js",
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
console.log("Built dist/index.js");
