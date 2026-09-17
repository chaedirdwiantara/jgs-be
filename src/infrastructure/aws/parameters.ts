import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

import { env } from "../../config/env.js";

const client = new SSMClient({ region: env.AWS_REGION });

/**
 * Module-scope cache. Lambda keeps a warm container across invocations, so a
 * secret is fetched once per container rather than once per request — the
 * difference between a few SSM calls a day and one per submission.
 *
 * The cache holds the promise, not the value, so concurrent first-callers share
 * one request instead of racing.
 */
const cache = new Map<string, Promise<string>>();

export function getParameter(name: string): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;

  const pending = client
    .send(new GetParameterCommand({ Name: name, WithDecryption: true }))
    .then((response) => {
      const value = response.Parameter?.Value;
      if (!value) throw new Error(`Parameter SSM "${name}" kosong.`);
      return value;
    })
    .catch((cause: unknown) => {
      // A failed fetch must not be cached — the next call should retry.
      cache.delete(name);
      throw cause;
    });

  cache.set(name, pending);
  return pending;
}

/** Returns `null` instead of throwing, for parameters that are optional. */
export async function getOptionalParameter(name: string): Promise<string | null> {
  try {
    return await getParameter(name);
  } catch {
    return null;
  }
}
