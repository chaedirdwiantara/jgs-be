/**
 * Outbound chat notification (Telegram today).
 *
 * Deliberately narrow: the domain hands over ready-made text and never learns
 * what a chat id or a bot token is.
 */
export interface ChatNotifier {
  /**
   * Must never throw. A rental application that reached the database is
   * submitted whether or not Telegram was reachable, so delivery failures are
   * logged and swallowed by the adapter.
   */
  send(message: string): Promise<void>;
}
