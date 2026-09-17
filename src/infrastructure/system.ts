import { randomUUID } from "node:crypto";

import type { Clock, IdGenerator } from "../domain/shared/ports.js";

export const systemClock: Clock = {
  now: () => new Date().toISOString(),
};

export const uuidGenerator: IdGenerator = {
  /** v4 from `node:crypto` — cryptographically random, so ids are unguessable. */
  generate: () => randomUUID(),
};
