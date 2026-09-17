import { env } from "../../config/env.js";
import type { ChatNotifier } from "../../domain/notification/chat-notifier.js";
import { getOptionalParameter } from "../aws/parameters.js";
import { logger } from "../logging/logger.js";

const API_BASE = "https://api.telegram.org";

/** Telegram is a courtesy ping; the console inbox is the system of record. */
const TIMEOUT_MS = 5_000;

/**
 * Sends the group message announcing a new rental application.
 *
 * The bot token and chat id come from SSM at call time rather than from the
 * function's environment, so the operator can create the bot (or move the
 * group) without a redeploy — see `docs/TELEGRAM.md`.
 *
 * Until both are set the adapter is a no-op that says so once per invocation.
 * That is deliberate: the system must be fully usable before Telegram exists.
 */
export class TelegramNotifier implements ChatNotifier {
  async send(message: string): Promise<void> {
    try {
      const [token, chatId] = await Promise.all([
        env.TELEGRAM_BOT_TOKEN ?? getOptionalParameter(env.TELEGRAM_BOT_TOKEN_PARAM),
        env.TELEGRAM_CHAT_ID ?? getOptionalParameter(env.TELEGRAM_CHAT_ID_PARAM),
      ]);

      if (!token || !chatId || token === UNSET || chatId === UNSET) {
        logger.info("telegram_not_configured");
        return;
      }

      const response = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        // Telegram explains refusals in the body ("chat not found", "bot was
        // blocked"), and that text is what makes this debuggable.
        logger.error("telegram_send_failed", {
          status: response.status,
          detail: (await response.text()).slice(0, 300),
        });
      }
    } catch (cause) {
      logger.error("telegram_send_error", {
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

/** Terraform seeds both parameters with this so the plan has something to apply. */
export const UNSET = "unset";
