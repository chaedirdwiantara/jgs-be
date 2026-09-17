import { describe, expect, it } from "vitest";

import { ScryptPasswordHasher } from "../src/infrastructure/crypto/scrypt-password-hasher.js";

const hasher = new ScryptPasswordHasher();

describe("ScryptPasswordHasher", () => {
  it("accepts the password it hashed", async () => {
    const hash = await hasher.hash("kata-sandi-yang-panjang");
    await expect(hasher.verify("kata-sandi-yang-panjang", hash)).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await hasher.hash("kata-sandi-yang-panjang");
    await expect(hasher.verify("kata-sandi-yang-salah", hash)).resolves.toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [first, second] = await Promise.all([hasher.hash("sama"), hasher.hash("sama")]);
    expect(first).not.toBe(second);
  });

  it("still does the work for a malformed hash", async () => {
    // The login flow depends on this: a missing account must cost the same as
    // a wrong password, or timing alone reveals which emails are registered.
    const started = performance.now();
    await expect(hasher.verify("apa saja", "")).resolves.toBe(false);
    const elapsed = performance.now() - started;

    // A short-circuit would return in microseconds; a real derivation at
    // N=16384 takes tens of milliseconds even on fast hardware.
    expect(elapsed).toBeGreaterThan(5);
  });

  it("refuses a hash that asks for an implausible amount of memory", async () => {
    // A tampered row must not be able to turn a login into an OOM crash.
    const hostile = `scrypt$${2 ** 30}$8$1$c2FsdA$a2V5`;
    await expect(hasher.verify("apa saja", hostile)).resolves.toBe(false);
  });
});
