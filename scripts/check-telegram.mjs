import "dotenv/config";
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN in the ignored .env file first.");
  process.exit(1);
}
async function call(method) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      method === "getUpdates"
        ? { timeout: 0, allowed_updates: ["message"] }
        : {},
    ),
    signal: AbortSignal.timeout(10000),
  });
  const d = await r.json();
  if (!d.ok) throw new Error("Telegram rejected request");
  return d.result;
}
try {
  const me = await call("getMe");
  console.log(`Connected to @${me.username}. No message was sent.`);
  const updates = await call("getUpdates");
  const rows = new Map();
  for (const u of updates) {
    const m = u.message;
    if (m)
      rows.set(String(m.chat.id), {
        chatType: m.chat.type,
        chatId: String(m.chat.id),
        senderUserId: String(m.from?.id ?? "unknown"),
      });
  }
  console.log("Recent numeric IDs (message contents omitted):");
  console.log(JSON.stringify([...rows.values()], null, 2));
  console.log(
    "Use your private-chat senderUserId as TELEGRAM_OPERATOR_ID and your consenting test group chatId as TELEGRAM_CHAT_ID. Stop the backend before running this discovery command.",
  );
} catch {
  console.error(
    "Telegram discovery failed. Check connectivity, token, and whether another bot poller is running. Token withheld.",
  );
  process.exit(1);
}
