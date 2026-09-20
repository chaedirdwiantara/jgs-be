import { container } from "./infrastructure/container.js";
import { logger } from "./infrastructure/logging/logger.js";

/**
 * Entry point for the daily reminder job (EventBridge Scheduler, 08:00 WIB —
 * see `infra/template.yaml`).
 *
 * A separate function from the HTTP API rather than a hidden route: it needs
 * no network exposure, no bearer token, and a different timeout. It shares the
 * container, so the use case it runs is the same one the tests exercise.
 */
export async function handler(): Promise<void> {
  const summary = await container.sendRentalReminders();
  logger.info("rental_reminders_sent", summary);
}
