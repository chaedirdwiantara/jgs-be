/**
 * Prints the chat id of every group the bot can currently see.
 *
 * Telegram does not offer a "what is my group's id" screen, so the supported
 * way to find one is to post a message in the group and read it back off the
 * bot's update queue — which is exactly what this does.
 *
 *   TELEGRAM_BOT_TOKEN=123456:AA… npx tsx scripts/telegram-chat-id.ts
 *
 * Send any message in the group first; `getUpdates` only returns updates the
 * bot has already received, and it keeps them for 24 hours.
 */
// Marks the file as a module, which is what makes top-level `await` legal.
export {};

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN first. See docs/TELEGRAM.md step 1.");
  process.exit(1);
}

type Update = {
  message?: { chat?: { id: number; title?: string; type?: string } };
  channel_post?: { chat?: { id: number; title?: string; type?: string } };
};

const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const payload = (await response.json()) as { ok: boolean; result?: Update[]; description?: string };

if (!payload.ok) {
  console.error(`Telegram menolak permintaan: ${payload.description ?? "unknown error"}`);
  process.exit(1);
}

const chats = new Map<number, { title: string; type: string }>();

for (const update of payload.result ?? []) {
  const chat = update.message?.chat ?? update.channel_post?.chat;
  if (chat) {
    chats.set(chat.id, { title: chat.title ?? "(tanpa nama)", type: chat.type ?? "?" });
  }
}

if (chats.size === 0) {
  console.log("Belum ada update. Kirim satu pesan di grup, lalu jalankan lagi.");
  console.log("Kalau tetap kosong: pastikan bot sudah menjadi anggota grup, dan");
  console.log("privacy mode dimatikan lewat @BotFather (/setprivacy -> Disable).");
  process.exit(0);
}

console.log("Chat yang terlihat oleh bot:\n");
for (const [id, chat] of chats) {
  console.log(`  ${id}  ${chat.type.padEnd(10)}  ${chat.title}`);
}
console.log("\nGrup punya id negatif (mis. -1001234567890). Simpan dengan:");
console.log("  aws ssm put-parameter --name /jgs/prod/telegram-chat-id \\");
console.log("    --value <chat-id> --type String --overwrite --region ap-southeast-1");
