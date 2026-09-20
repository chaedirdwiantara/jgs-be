import { env } from "../../config/env.js";
import type { ChatNotifier } from "../../domain/notification/chat-notifier.js";
import { getOptionalParameter } from "../aws/parameters.js";
import { logger } from "../logging/logger.js";

const API_BASE = "https://api.telegram.org";

/** Telegram is a courtesy ping; the console is the system of record. */
const TIMEOUT_MS = 5_000;

/**
 * Which group a notifier posts to. One bot serves every group; only the chat
 * id differs, so each audience is a separate instance of the same adapter.
 *
 * - `applications`: the inbox group, pinged for every new form submission.
 * - `rentals`: the operations group, pinged for schedule and payment events.
 */
export type TelegramAudience = "applications" | "rentals";

const CHAT_ID_SOURCE: Record<
  TelegramAudience,
  { override: string | undefined; parameter: string }
> = {
  applications: { override: env.TELEGRAM_CHAT_ID, parameter: env.TELEGRAM_CHAT_ID_PARAM },
  rentals: {
    override: env.TELEGRAM_RENTAL_CHAT_ID,
    parameter: env.TELEGRAM_RENTAL_CHAT_ID_PARAM,
  },
};

/**
 * Sends one group message.
 *
 * The bot token and chat id come from SSM at call time rather than from the
 * function's environment, so the operator can create the bot (or move a
 * group) without a redeploy — see `docs/TELEGRAM.md`.
 *
 * Until both are set the adapter is a no-op that says so once per call. That
 * is deliberate: the system must be fully usable before Telegram exists, and
 * the rental group may be wired up weeks after the inbox group.
 */
export class TelegramNotifier implements ChatNotifier {
  constructor(private readonly audience: TelegramAudience) {}

  async send(message: string): Promise<void> {
    const source = CHAT_ID_SOURCE[this.audience];

    try {
      const [token, chatId] = await Promise.all([
        env.TELEGRAM_BOT_TOKEN ?? getOptionalParameter(env.TELEGRAM_BOT_TOKEN_PARAM),
        source.override ?? getOptionalParameter(source.parameter),
      ]);

      if (!token || !chatId || token === UNSET || chatId === UNSET) {
        logger.info("telegram_not_configured", { audience: this.audience });
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
          audience: this.audience,
          status: response.status,
          detail: (await response.text()).slice(0, 300),
        });
      }
    } catch (cause) {
      logger.error("telegram_send_error", {
        audience: this.audience,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
}

/** `bootstrap.sh` seeds every chat parameter with this until the operator fills it in. */
export const UNSET = "unset";
