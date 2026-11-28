import { readFile } from "node:fs/promises";
import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";
import type {
  PersonalProvider,
  Chat,
  Message,
  PersonalAction,
  History,
  Sponsored,
} from "./types.js";
import { Problem } from "../store.js";
export class AccountTelegram implements PersonalProvider {
  readonly synthetic = false;
  private ads = new Map<string, { chatId: string; randomId: Buffer }>();
  private peers = new Map<string, Api.TypeInputPeer>();
  private peer(id: string) {
    const peer = this.peers.get(id);
    if (!peer) throw new Problem(404, "Refresh your chat list first.");
    return peer;
  }
  constructor(private client: TelegramClient) {}
  static credentials() {
    const apiId = Number(process.env.TELEGRAM_API_ID),
      apiHash = process.env.TELEGRAM_API_HASH ?? "";
    return { apiId, apiHash, ok: Number.isInteger(apiId) && apiId > 0 && !!apiHash };
  }
  static sessionFile() {
    return process.env.TELEGRAM_SESSION_FILE ?? ".data/personal.session";
  }
  /** Saved session string, or null when no session file exists yet. */
  static async readSession(path = AccountTelegram.sessionFile()) {
    try {
      const session = (await readFile(path, "utf8")).trim();
      return session || null;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  /** Connect with a session string; throws if Telegram does not accept it. */
  static async fromSession(session: string) {
    const { apiId, apiHash, ok } = AccountTelegram.credentials();
    if (!ok)
      throw new Error(
        "Set your own TELEGRAM_API_ID and TELEGRAM_API_HASH first.",
      );
    const client = new TelegramClient(
      new StringSession(session.trim()),
      apiId,
      apiHash,
      { connectionRetries: 2, requestRetries: 1, floodSleepThreshold: 0 },
    );
    client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);
    await client.connect();
    if (!(await client.checkAuthorization())) {
      await client.disconnect();
      throw new Error(
        "Telegram session is not authorized. Sign in again at /login.",
      );
    }
    return new AccountTelegram(client);
  }
  static async connect() {
    const session = await AccountTelegram.readSession();
    if (!session)
      throw new Error("No Telegram session yet. Sign in at /login.");
    return AccountTelegram.fromSession(session);
  }
  async dialogs(): Promise<Chat[]> {
    const rows = await this.client.getDialogs({ limit: 100 });
    for (const d of rows)
      if (d.id) this.peers.set(d.id.toString(), d.inputEntity);
    return rows
      .filter((d) => d.id && !d.isCommunity)
      .map((d) => ({
        id: d.id!.toString(),
        title: d.title ?? d.name ?? "Chat",
        kind: d.isUser ? "dm" : d.isGroup ? "group" : "channel",
        unread: d.unreadCount,
        preview: d.message?.message?.trim().slice(0, 160),
        // Telegram dates are seconds; the lens works in epoch ms.
        lastDate: d.message?.date ? d.message.date * 1000 : undefined,
        readMaxId: d.dialog instanceof Api.Dialog ? d.dialog.readInboxMaxId : 0,
        muted: mutedNow(d.dialog, this.now()),
      }));
  }
  /** Clock for mute checks (tests pin it). */
  now = () => Date.now();
  async saved(): Promise<Chat> {
    const me = await this.client.getMe();
    const id = me.id.toString();
    this.peers.set(id, new Api.InputPeerSelf());
    return { id, title: "Saved Messages", kind: "dm", unread: 0, readMaxId: 0 };
  }
  async history(chat: Chat, search = "", before?: number): Promise<History> {
    const rows = await this.client.getMessages(this.peer(chat.id), {
      limit: 40,
      search: search || undefined,
      offsetId: before,
    });
    const messages: Message[] = rows.map((m) => {
      const sender = m.sender;
      const name =
        sender instanceof Api.User
          ? [sender.firstName, sender.lastName].filter(Boolean).join(" ")
          : sender && "title" in sender
            ? sender.title
            : undefined;
      return {
        id: m.id,
        chatId: chat.id,
        sender: m.out ? "You" : (name ?? "Participant"),
        text: m.message ?? "",
        outgoing: !!m.out,
        date: m.date * 1000,
        replyTo: m.replyToMsgId,
        editedAt: m.editDate ? m.editDate * 1000 : undefined,
        media: m.media?.className,
      };
    });
    const sponsored: Sponsored[] = [];
    if (chat.kind === "channel") {
      const result = await this.client.invoke(
        new Api.messages.GetSponsoredMessages({ peer: this.peer(chat.id) }),
      );
      if (result instanceof Api.messages.SponsoredMessages)
        for (const ad of result.messages) {
          const id = ad.randomId.toString("base64url");
          this.ads.set(id, { chatId: chat.id, randomId: ad.randomId });
          if (ad.media || ad.photo)
            throw new Problem(
              501,
              "This channel requires a rich sponsored presentation. Open it in Telegram.",
            );
          sponsored.push({
            id,
            title: ad.title,
            text: ad.message,
            url: ad.url,
            buttonText: ad.buttonText,
            disclosure: [ad.sponsorInfo, ad.additionalInfo]
              .filter(Boolean)
              .join("\n"),
            minSeconds: ad.minDisplayDuration ?? 5,
          });
        }
    }
    return { messages: messages.sort((a, b) => a.id - b.id), sponsored };
  }
  async write(action: PersonalAction) {
    if (action.kind === "reply" || action.kind === "send") {
      const m = await this.client.sendMessage(this.peer(action.chatId), {
        message: action.text!,
        replyTo: action.kind === "reply" ? action.messageId : undefined,
        parseMode: false,
      });
      if (!Number.isInteger(m.id) || m.id <= 0)
        throw new Error("Missing Telegram receipt");
      return { messageId: m.id };
    }
    if (action.kind === "save") {
      const messages = await this.client.forwardMessages("me", {
        messages: [action.messageId],
        fromPeer: this.peer(action.chatId),
      });
      if (!messages[0]?.id) throw new Error("Missing Saved Messages receipt");
      return { messageId: messages[0].id };
    }
    await this.client.invoke(
      new Api.messages.SendReaction({
        peer: this.peer(action.chatId),
        msgId: action.messageId,
        reaction: [new Api.ReactionEmoji({ emoticon: action.reaction! })],
      }),
    );
    return {};
  }
  async read(chatId: string, id: number) {
    await this.client.markAsRead(this.peer(chatId), id);
  }
  async sponsoredView(chatId: string, id: string) {
    const ad = this.ads.get(id);
    if (!ad || ad.chatId !== chatId)
      throw new Problem(404, "Sponsored message expired.");
    await this.client.invoke(
      new Api.messages.ViewSponsoredMessage({ randomId: ad.randomId }),
    );
  }
  async sponsoredClick(chatId: string, id: string) {
    const ad = this.ads.get(id);
    if (!ad || ad.chatId !== chatId)
      throw new Problem(404, "Sponsored message expired.");
    await this.client.invoke(
      new Api.messages.ClickSponsoredMessage({ randomId: ad.randomId }),
    );
  }
  async close() {
    await this.client.disconnect();
  }
}

/**
 * Per-chat mute from the dialog's notify settings: muted while
 * `muteUntil` (Telegram seconds) is in the future. Account-wide default
 * notify settings are not resolved, so a chat muted only by a global
 * default reads as not muted.
 */
export function mutedNow(dialog: unknown, now: number) {
  if (!(dialog instanceof Api.Dialog)) return false;
  const settings = dialog.notifySettings;
  if (!(settings instanceof Api.PeerNotifySettings)) return false;
  return (settings.muteUntil ?? 0) * 1000 > now;
}
