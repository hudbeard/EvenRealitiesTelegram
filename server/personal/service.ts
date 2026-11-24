import { createHash } from "node:crypto";
import { Store, Problem } from "../store.js";
import type {
  Chat,
  Message,
  PersonalAction,
  PersonalProvider,
} from "./types.js";
import { catchup } from "./brief.js";
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class PersonalService {
  constructor(
    public store: Store,
    public provider: PersonalProvider,
  ) {
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS personal_actions(id TEXT PRIMARY KEY,hash TEXT NOT NULL,status TEXT NOT NULL,result TEXT,createdAt INTEGER NOT NULL); UPDATE personal_actions SET status='uncertain' WHERE status='sending';",
    );
  }
  private get(key: string) {
    return (
      this.store.db
        .prepare("SELECT value FROM metadata WHERE key=?")
        .get("personal:" + key) as { value: string } | undefined
    )?.value;
  }
  private set(key: string, value: string) {
    this.store.db
      .prepare(
        "INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run("personal:" + key, value);
  }
  watched(): string[] {
    return JSON.parse(this.get("watched") ?? "[]");
  }
  async select(ids: string[]) {
    const chats = await this.provider.dialogs();
    if (
      !Array.isArray(ids) ||
      ids.length > 10 ||
      ids.some(
        (id) => typeof id !== "string" || !chats.some((c) => c.id === id),
      )
    )
      throw new Problem(400, "Choose up to ten chats from your account.");
    this.set("watched", JSON.stringify([...new Set(ids)]));
    return this.watched();
  }
  async chat(id: string, accountScope = false): Promise<Chat> {
    if (!accountScope && !this.watched().includes(id))
      throw new Problem(403, "Choose this chat on your phone first.");
    let chat = (await this.provider.dialogs()).find((c) => c.id === id);
    if (!chat && accountScope) {
      const saved = await this.provider.saved();
      if (saved.id === id) chat = saved;
    }
    if (!chat) throw new Problem(404, "Chat is no longer available.");
    return chat;
  }
  async history(id: string, search = "") {
    if (search.length > 120) throw new Problem(400, "Search is too long.");
    const chat = await this.chat(id),
      history = await this.provider.history(chat, search);
    return {
      ...history,
      messages: history.messages.map((m) => ({
        ...m,
        revision: digest(m.text),
      })),
    };
  }
  async accountHistory(id: string, search = "", before?: number) {
    if (
      search.length > 120 ||
      (before !== undefined && (!Number.isInteger(before) || before <= 0))
    )
      throw new Problem(400, "Invalid history request.");
    const chat = await this.chat(id, true),
      h = await this.provider.history(chat, search, before);
    return {
      ...h,
      chat,
      messages: h.messages.map((m) => ({ ...m, revision: digest(m.text) })),
      hasOlder: h.messages.length === 40,
    };
  }
  async brief() {
    const chats = (await this.provider.dialogs()).filter((c) =>
      this.watched().includes(c.id),
    );
    // Channel content is opened in its dedicated history view with sponsored content,
    // never repackaged into an ad-free cross-chat feed.
    const sources: Message[] = [];
    for (const chat of chats.filter((c) => c.kind !== "channel"))
      sources.push(...(await this.provider.history(chat)).messages);
    return {
      cards: catchup(
        chats,
        sources,
        Number(this.get("checkpoint") ?? String(Date.now() - 24 * 3600000)),
      ),
      chats,
      synthetic: this.provider.synthetic,
    };
  }
  checkpoint() {
    this.set("checkpoint", String(Date.now()));
  }
  async act(
    id: string,
    action: PersonalAction,
    revision: string,
    accountScope = false,
  ): Promise<{ status: string; result: unknown }> {
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(id))
      throw new Problem(400, "Invalid confirmation ID.");
    if (
      !action ||
      (!accountScope && action.kind === "send") ||
      !["reply", "send", "react", "save"].includes(action.kind) ||
      !Number.isInteger(action.messageId) ||
      (action.messageId <= 0 &&
        !(accountScope && action.kind === "send" && action.messageId === 0))
    )
      throw new Problem(400, "Invalid action.");
    if (
      (action.kind === "reply" || action.kind === "send") &&
      (typeof action.text !== "string" ||
        !action.text.trim() ||
        action.text.length > 4096)
    )
      throw new Problem(400, "Write a reply of 1–4096 characters.");
    if (
      action.kind === "react" &&
      !["👍", "❤️", "✅"].includes(action.reaction ?? "")
    )
      throw new Problem(400, "Choose a supported reaction.");
    const hash = digest({ action, revision, accountScope });
    const old = this.store.db
      .prepare("SELECT * FROM personal_actions WHERE id=?")
      .get(id) as
      { hash: string; status: string; result: string | null } | undefined;
    if (old) {
      if (old.hash !== hash)
        throw new Problem(409, "Confirmation changed. Review it again.");
      return {
        status: old.status,
        result: old.result ? JSON.parse(old.result) : null,
      };
    }
    const chat = await this.chat(action.chatId, accountScope);
    if (
      chat.kind === "channel" &&
      (action.kind === "reply" || action.kind === "send")
    )
      throw new Problem(
        400,
        "Reply in the linked discussion using Telegram; direct channel posting is not offered.",
      );
    if (action.kind !== "send") {
      const current = (
        await this.provider.history(chat, undefined, action.messageId + 1)
      ).messages.find((m) => m.id === action.messageId);
      if (!current)
        throw new Problem(
          409,
          "Source message is no longer available. Reopen the chat.",
        );
      if (digest(current.text) !== revision)
        throw new Problem(
          409,
          "Source changed since review. Read it again before acting.",
        );
    }
    // Recheck after provider awaits: a parallel request may already have claimed this ID.
    const claimed = this.store.db
      .prepare(
        "INSERT OR IGNORE INTO personal_actions VALUES(?,?,'sending',NULL,?)",
      )
      .run(id, hash, Date.now());
    if (!claimed.changes) return this.act(id, action, revision, accountScope);
    try {
      const receipt = await this.provider.write(action);
      const result =
        action.kind === "send" || action.kind === "reply"
          ? { ...receipt, revision: digest(action.text) }
          : receipt;
      this.store.db
        .prepare(
          "UPDATE personal_actions SET status='sent',result=? WHERE id=?",
        )
        .run(JSON.stringify(result), id);
      return { status: "sent", result };
    } catch {
      this.store.db
        .prepare("UPDATE personal_actions SET status='uncertain' WHERE id=?")
        .run(id);
      return { status: "uncertain", result: null };
    }
  }
}
