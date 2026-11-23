import { Problem, Store, type Task } from "./store.js";
export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  date: number;
  chat: { id: number; title?: string; type: string };
  from?: { id: number; first_name?: string; is_bot?: boolean };
  text?: string;
};
export type Update = { update_id: number; message?: TelegramMessage };
export class Rejected extends Error {}
export interface Transport {
  send(task: Task, text: string): Promise<number>;
}
export class Telegram implements Transport {
  constructor(
    private token: string,
    private apiFetch: typeof fetch = fetch,
  ) {}
  async call(method: string, body: unknown, timeout = 15000) {
    const response = await this.apiFetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      },
    );
    // Non-JSON responses and transport failures leave delivery ambiguous.
    const data = (await response.json()) as {
      ok: boolean;
      result: any;
      description?: string;
    };
    if (!data.ok) {
      if (response.status >= 500)
        throw new Error("Telegram service unavailable");
      throw new Rejected(
        "Telegram rejected the request. Check bot membership and chat permissions.",
      );
    }
    return data.result;
  }
  async send(task: Task, text: string): Promise<number> {
    const message = await this.call("sendMessage", {
      chat_id: task.chatId,
      text,
      message_thread_id: task.threadId ?? undefined,
      reply_parameters: {
        message_id: task.messageId,
        allow_sending_without_reply: false,
      },
    });
    if (
      !Number.isInteger(message?.message_id) ||
      message.message_id <= 0 ||
      String(message.chat?.id) !== task.chatId
    ) {
      throw new Error("Telegram receipt could not be verified");
    }
    return message.message_id;
  }
  updates(offset: number): Promise<Update[]> {
    return this.call(
      "getUpdates",
      { offset, timeout: 20, allowed_updates: ["message"] },
      25000,
    );
  }
}
export const replies = ["On my way.", "Done.", "I cannot cover this."] as const;
export async function confirm(
  store: Store,
  transport: Transport,
  id: string,
  operationId: string,
  choice: number,
  label: string,
) {
  if (!Number.isInteger(choice) || choice < 0 || choice >= replies.length)
    throw new Problem(400, "Choose a valid reply.");
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(operationId))
    throw new Problem(400, "Invalid confirmation.");
  const text = `${label}: ${replies[choice]}`;
  const { task, claimed } = store.claim(id, operationId, text);
  if (!claimed) return task;
  try {
    const receipt = await transport.send(task, text);
    if (!Number.isInteger(receipt) || receipt <= 0)
      throw new Error("Invalid delivery receipt");
    return store.outcome(id, "sent", receipt);
  } catch (e) {
    return store.outcome(id, e instanceof Rejected ? "failed" : "uncertain");
  }
}
export function ingest(
  store: Store,
  update: Update,
  allowedChat: string,
  now = Date.now(),
) {
  const m = update.message;
  if (!m || String(m.chat.id) !== allowedChat || m.from?.is_bot || !m.text)
    return;
  const match = m.text.match(/^\/request(?:@[a-zA-Z0-9_]+)?\s+([\s\S]+)$/i);
  if (!match) return;
  const text = match[1].trim();
  if (!text || text.length > 2000 || m.date * 1000 < now - 30 * 60000) return;
  store.add({
    id: `${m.chat.id}:${m.message_id}`,
    chatId: String(m.chat.id),
    chatName: m.chat.title ?? "Test chat",
    messageId: m.message_id,
    threadId: m.message_thread_id ?? null,
    sender: m.from?.first_name ?? "Coordinator",
    text,
    createdAt: m.date * 1000,
    expiresAt: m.date * 1000 + 30 * 60000,
  });
}
