import type {
  Chat,
  Message,
  PersonalAction,
  BriefCard,
  Sponsored,
} from "../../server/personal/types.js";
export type Source = Message & { revision: string };
export type Frame = {
  title: string;
  body: string;
  footer: string;
  icon: string;
  badge?: string;
  context?: string;
  split?: { rows: string[]; index: number; heading: string; detail: string };
  native?: string[];
  shortcuts?: { id: number; label: string }[];
};
export type Input = "up" | "down" | "tap" | "back";
export type Request = (path: string, body?: unknown) => Promise<any>;
type Row = {
  label: string;
  detail?: string;
  preview?: string;
  chatId?: string;
  run: () => void | Promise<void>;
};
type Back = () => void | Promise<void>;
type Menu = {
  title: string;
  icon: string;
  rows: Row[];
  index: number;
  back: Back;
  native: boolean;
  context?: string;
  badge?: string;
  footer?: string;
};
export { wrap } from "./text.js";
import { fitLine, wrap } from "./text.js";
const short = (s: string, n = 42) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;
function replyChoices(source: Source) {
  const time = source.text.match(/\b\d{1,2}:\d{2}(?:\s?[ap]\.?m\.?)?\b/i)?.[0];
  if (/\b(instead|moved to|new plan|rescheduled|update:)\b/i.test(source.text))
    return [
      ["Acknowledge", "Got it, thanks for the update."],
      [
        "Clarify plan",
        time
          ? "Is " + time + " the new time?"
          : "Can you confirm the new plan?",
      ],
    ];
  if (/\b(when|what time|how soon|eta)\b/i.test(source.text))
    return [
      ["Check timing", "I’ll confirm the time shortly."],
      ["Ask what works", "What time works for you?"],
    ];
  if (/\b(where|which location|address)\b/i.test(source.text))
    return [
      ["Ask for location", "Can you send the exact location?"],
      ["Check location", "I’ll confirm the location shortly."],
    ];
  if (/\b(can|could|would|will) you\b/i.test(source.text))
    return [
      ["Check first", "I’ll check and get back to you."],
      ["Ask for details", "Can you share a little more detail?"],
    ];
  return [
    ["Acknowledge", "Got it, thanks!"],
    ["Reply later", "I’ll get back to you shortly."],
  ];
}
const shortcut = {
  inbox: { id: 1, label: "Open inbox" },
  findChat: { id: 2, label: "Find a chat" },
  newMessage: { id: 3, label: "New message" },
  findMessage: { id: 4, label: "Find in chat" },
  messageActions: { id: 5, label: "Message actions" },
  nextUnread: { id: 7, label: "Next unread chat" },
  saved: { id: 8, label: "Saved Messages" },
  catchup: { id: 9, label: "Open catch-up" },
  settings: { id: 10, label: "Settings" },
  redictate: { id: 11, label: "Dictate again" },
};
export class GlassesApp {
  frame: Frame = {
    title: "FIELDLINE / TELEGRAM",
    body: "Connecting to your server…",
    footer: "",
    icon: "glasses",
  };
  menu?: Menu;
  busy = false;
  synthetic = false;
  voiceEnabled = false;
  replyIdeasEnabled = false;
  active = true;
  chats: Chat[] = [];
  watched: string[] = [];
  chat?: Chat;
  messages: Source[] = [];
  messageIndex = 0;
  hasOlder = false;
  query = "";
  mode = "home";
  page = 0;
  reading = "";
  readTitle = "";
  readIcon = "message";
  onRead = async () => {};
  onReadBack = async () => {};
  draft = "";
  reply?: Source;
  private quick:
    | {
        source: Source;
        choices: { text: string; ai?: boolean }[];
        index: number;
      }
    | undefined;
  private ideas = new Map<string, Promise<string[]>>();
  readContext?: string;
  readBadge?: string;
  readAction = "Continue";
  threadBack: Back = () => this.chatList();
  drafts = new Map<string, string>();
  private searchOrigin?: number;
  private chatSearchOrigin?: string;
  private readThrough = new Map<string, number>();
  /** Read acknowledgements run one at a time, in the order messages were seen. */
  private ackChain: Promise<void> = Promise.resolve();
  inputPurpose: "compose" | "chats" | "messages" = "compose";
  pending?: PersonalAction;
  operationId = "";
  pendingRevision = "";
  cards: BriefCard[] = [];
  /** Clock for the Send-now guard; tests replace it. */
  now: () => number = () => Date.now();
  /** Called after the display session is revoked. main.ts clears the token and shows Welcome. */
  disconnected: () => void = () => {};
  /** A review's action cannot run before this time (1 s entry guard). */
  private actionGuardUntil = 0;
  constructor(
    public api: Request,
    public changed: (frame: Frame) => void,
    public exit: () => Promise<void> = async () => {},
    public record: () => Promise<void> = async () => {},
  ) {}
  emit(frame: Frame) {
    this.frame = frame;
    this.changed(frame);
  }
  showMenu(
    title: string,
    icon: string,
    rows: Row[],
    back: () => void | Promise<void>,
    index = 0,
    style: Pick<Menu, "context" | "badge" | "footer"> & {
      native?: boolean;
    } = {},
  ) {
    this.mode = "menu";
    this.menu = {
      title,
      icon,
      rows,
      index: Math.min(index, Math.max(0, rows.length - 1)),
      back,
      ...style,
      native: style.native ?? false,
    };
    this.drawMenu();
  }
  drawMenu() {
    const menu = this.menu!;
    const visibleCount = 3;
    const start = Math.floor(menu.index / visibleCount) * visibleCount;
    const rows = menu.rows.slice(start, start + visibleCount);
    const selected = menu.rows[menu.index];
    const shortcuts =
      menu.icon === "chats"
        ? [
            ...(this.voiceEnabled ? [shortcut.findChat] : []),
            shortcut.saved,
            shortcut.catchup,
            shortcut.settings,
          ]
        : [];
    this.emit({
      title: menu.title,
      icon: menu.icon,
      badge:
        menu.badge ??
        (menu.rows.length && !menu.native
          ? menu.index + 1 + " / " + menu.rows.length
          : undefined),
      context: menu.context,
      body: rows
        .map((row, i) => (start + i === menu.index ? "> " : "  ") + row.label)
        .join("\n"),
      footer: menu.footer ?? "Swipe  Select     Tap  Open     Double tap  Back",
      split: menu.native
        ? undefined
        : {
            rows: rows.map((row) => row.label),
            index: menu.index - start,
            heading: selected?.preview ?? selected?.label ?? "No items",
            detail: selected?.detail ?? "",
          },
      native: menu.native ? menu.rows.map((row) => row.label) : undefined,
      shortcuts,
    });
  }
  async start() {
    const h = await this.api("/health");
    this.synthetic = h.synthetic;
    this.voiceEnabled = h.voiceEnabled;
    this.replyIdeasEnabled = h.replyIdeasEnabled === true;
    await this.home();
  }
  async refresh() {
    const d = await this.api("/glasses/dialogs");
    this.chats = d.chats;
    this.watched = d.watched;
  }
  async home() {
    await this.refresh();
    this.chatList();
  }
  confirmExit() {
    // Tap exits; Double tap (Back) returns to Chats on the same row.
    const index = this.menu?.icon === "chats" ? this.menu.index : 0;
    this.confirm(
      "EXIT FIELDLINE?",
      "Close Fieldline on your glasses.",
      "Exit now",
      () => this.exit(),
      () => {
        this.chatList();
        if (this.menu?.icon === "chats") {
          this.menu.index = Math.max(
            0,
            Math.min(index, this.menu.rows.length - 1),
          );
          this.drawMenu();
        }
      },
    );
  }
  async openSaved() {
    const saved = await this.api("/glasses/saved");
    await this.openChat(saved, "", undefined, undefined, () => this.chatList());
  }
  chatList(filter = "", unreadOnly = false, focusId?: string) {
    const ordered = this.chats
      .filter((chat) => chat.unread)
      .concat(this.chats.filter((chat) => !chat.unread));
    const matches = ordered.filter(
      (chat) =>
        (!unreadOnly || chat.unread > 0 || chat.id === focusId) &&
        chat.title.toLowerCase().includes(filter.toLowerCase()),
    );
    const backToList = (id?: string) => this.chatList(filter, unreadOnly, id);
    this.showMenu(
      filter ? "Chat search" : "Chats",
      "chats",
      [
        ...matches.map((chat) => ({
          label: (chat.unread ? "● " : "") + chat.title,
          preview: chat.title,
          chatId: chat.id,
          detail:
            (chat.kind === "dm"
              ? "Direct message"
              : chat.kind === "group"
                ? "Group"
                : "Channel") +
            " · " +
            (chat.unread ? chat.unread + " unread" : "Up to date") +
            (chat.preview ? "\n\n" + chat.preview.replace(/\s+/g, " ") : ""),
          run: () =>
            this.openChat(chat, "", undefined, undefined, () =>
              backToList(chat.id),
            ),
        })),
        ...(this.voiceEnabled
          ? [
              {
                label: "Find a chat",
                detail: "Say the name of a chat.",
                run: () => this.startSearch("chats"),
              },
            ]
          : []),
        ...(filter || unreadOnly
          ? [
              {
                label: "All chats",
                detail: "Clear the filter.",
                run: () => this.chatList(),
              },
            ]
          : []),
        // Only add Saved Messages if not already in matches (Designer fix #6)
        ...(matches.some((c) => c.title === "Saved Messages")
          ? []
          : [
              {
                label: "Saved Messages",
                detail: "Open your Telegram notebook.",
                run: () => this.openSaved(),
              },
            ]),
        {
          label: "Catch-up",
          detail: "See changes, questions, and commitments.",
          run: () => this.catchup(),
        },
        {
          label: "Refresh",
          detail: "Check for new conversations and messages.",
          run: async () => {
            await this.refresh();
            backToList(focusId);
          },
        },
        {
          label: "Settings",
          detail: "Controls, connection, and catch-up chats.",
          run: () => this.connection(),
        },
      ],
      filter || unreadOnly
        ? () => this.chatList("", false, this.chatSearchOrigin)
        : () => this.confirmExit(),
      Math.max(
        0,
        matches.findIndex((chat) => chat.id === focusId),
      ),
      {
        badge: this.synthetic ? "DEMO" : undefined,
        context: filter
          ? "“" + short(filter, 30) + "” · " + matches.length + " found"
          : undefined,
        footer: this.voiceEnabled
          ? "Swipe  Chats    Tap  Open    Hold  Find"
          : "Swipe  Chats    Tap  Open    Tap+hold  Menu",
      },
    );
  }
  async openChat(
    chat: Chat,
    search = "",
    focusId?: number,
    before?: number,
    back?: Back,
  ) {
    if (!back && this.chat?.id !== chat.id)
      back = () => this.chatList("", false, chat.id);
    const d = await this.api(
      "/glasses/chats/" +
        encodeURIComponent(chat.id) +
        "/messages?search=" +
        encodeURIComponent(search) +
        (before ? "&before=" + before : ""),
    );
    if (this.chat?.id !== chat.id) {
      this.draft = "";
      this.reply = undefined;
    }
    this.chat = d.chat ?? chat;
    const row = this.chats.findIndex((item) => item.id === chat.id);
    if (row >= 0 && d.chat) this.chats[row] = d.chat;
    if (back) this.threadBack = back;
    const older: Source[] = d.messages;
    this.messages = before
      ? [...older, ...this.messages.filter((message) => message.id >= before)]
      : older;
    this.hasOlder = d.hasOlder;
    this.query = search;
    let index = focusId
      ? this.messages.findIndex((m) => m.id === focusId)
      : this.messages.findIndex(
          (m) =>
            !m.outgoing &&
            m.id >
              Math.max(
                this.chat!.readMaxId,
                this.readThrough.get(chat.id) ?? 0,
              ),
        );
    this.messageIndex = before
      ? Math.max(0, older.length - (older.length ? 1 : 0))
      : index < 0
        ? Math.max(0, this.messages.length - 1)
        : index;
    const enter = async () => this.thread();
    if (d.sponsored?.length) await this.ads(d.sponsored, 0, enter);
    else await enter();
  }
  async ads(ads: Sponsored[], i: number, done: () => Promise<void>) {
    const ad = ads[i],
      start = Date.now();
    this.read(
      "SPONSORED / " + ad.title,
      ad.text + "\n" + (ad.disclosure ?? "") + "\n" + ad.url,
      "channel",
      async () => {
        if (Date.now() - start < Math.max(5, ad.minSeconds ?? 5) * 1000)
          throw new Error(
            "Please finish reading. Sponsored message minimum display time: " +
              Math.max(5, ad.minSeconds ?? 5) +
              " seconds.",
          );
        await this.api(
          "/glasses/chats/" +
            encodeURIComponent(this.chat!.id) +
            "/sponsored/" +
            encodeURIComponent(ad.id) +
            "/view",
          {},
        );
        if (i + 1 < ads.length) await this.ads(ads, i + 1, done);
        else await done();
      },
      this.threadBack,
    );
  }
  async thread(status?: string) {
    this.mode = "thread";
    this.menu = undefined;
    const c = this.chat!,
      m = this.messages[this.messageIndex];
    const total = this.messages.length;
    if (this.messageIndex < 0) {
      this.emit({
        title: short(c.title),
        icon: "history",
        body:
          "Load older messages\n\nTap to fetch the previous 40.\n" +
          (this.query ? "Search: " + this.query : ""),
        footer: "Tap  Load older     Double tap  Back",
        shortcuts: this.threadShortcuts(),
      });
      return;
    }
    if (!m) {
      this.emit({
        title: short(c.title),
        icon: "compose",
        body: this.query
          ? "No messages match your search."
          : total
            ? "You’re at the latest message."
            : "No messages yet.",
        footer: this.query
          ? "Double tap  Clear search"
          : this.voiceEnabled && c.kind !== "channel"
            ? "Tap  Dictate new     Double tap  Back"
            : "Double tap  Back    Tap+hold  Menu",
        shortcuts: this.threadShortcuts(),
      });
      return;
    }
    const date = new Date(m.date).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    const lines = this.messageLines(m);
    const original = this.messages.find((parent) => parent.id === m.replyTo);
    const action =
      lines.length > 5 ? "Read" : c.kind === "channel" ? "Actions" : "Reply";
    const quote =
      original && lines.length <= 3
        ? "\n\n" +
          fitLine("In reply to " + original.sender + ": " + original.text, 520)
        : "";
    this.emit({
      title: c.title,
      badge: this.messageIndex + 1 + " / " + total,
      icon: c.kind === "dm" ? "user" : c.kind === "group" ? "users" : "channel",
      context:
        (status ? status + " · " : "") +
        m.sender +
        " · " +
        date +
        (!m.outgoing &&
        m.id > Math.max(c.readMaxId, this.readThrough.get(c.id) ?? 0)
          ? " · UNREAD"
          : "") +
        (this.query ? " · SEARCH RESULT" : ""),
      body: lines.slice(0, 5).join("\n") + quote,
      footer:
        "Swipe  Messages   Tap  " +
        action +
        (this.voiceEnabled && c.kind !== "channel"
          ? "   Hold  Dictate"
          : "   Tap+hold  Menu"),
      shortcuts: this.threadShortcuts(m, lines.length <= 5),
    });
    // Seen = fully painted on the normal 5-line path. Search results and
    // long messages (which need Read) are not marked read by a swipe.
    if (lines.length <= 5 && !this.query) void this.queueAck(m);
  }
  /**
   * The next chat with unread messages after the current one (inbox order,
   * wrapping), refreshed from the server once pending read acks land.
   */
  async nextUnreadChat() {
    await this.settled();
    await this.refresh();
    const here = this.chats.findIndex((chat) => chat.id === this.chat?.id);
    const ordered =
      here < 0
        ? this.chats
        : [...this.chats.slice(here + 1), ...this.chats.slice(0, here)];
    return ordered.find((chat) => chat.unread > 0 && chat.id !== this.chat?.id);
  }
  /** Swipe down past the last message: next unread chat, or “caught up”. */
  async continueToNextUnread() {
    const next = await this.nextUnreadChat();
    if (next) {
      await this.openChat(next, "", undefined, undefined, () =>
        this.chatList("", false, next.id),
      );
      return;
    }
    const here = this.chat?.id;
    this.read(
      "You’re caught up",
      "No other unread chats.",
      "check",
      () => this.chatList("", false, here),
      () => this.thread(),
      { action: "Inbox" },
    );
  }
  /** Queue a best-effort read acknowledgement after any earlier ones. */
  queueAck(message: Source) {
    const run = this.ackChain.then(() => this.acknowledge(message));
    this.ackChain = run;
    return run;
  }
  /** Resolves once every queued read acknowledgement has finished. */
  settled() {
    return this.ackChain;
  }
  messageLines(message: Source) {
    return wrap(
      message.text || "[" + (message.media ?? "Media") + " · view in Telegram]",
    );
  }
  threadShortcuts(message?: Source, fullyVisible = false) {
    return [
      ...(message && fullyVisible ? [shortcut.messageActions] : []),
      ...(this.voiceEnabled
        ? [
            ...(this.chat?.kind !== "channel" ? [shortcut.newMessage] : []),
            shortcut.findMessage,
          ]
        : []),
      shortcut.nextUnread,
      shortcut.inbox,
    ];
  }
  canDictate() {
    if (!this.voiceEnabled) return false;
    if (this.mode === "menu") return this.menu?.icon === "chats";
    if (this.mode === "thread")
      return this.chat?.kind !== "channel" && !!this.chat;
    if (this.mode === "quick") return true;
    return (
      this.mode === "read" &&
      this.readIcon === "send" &&
      (this.pending?.kind === "send" || this.pending?.kind === "reply")
    );
  }
  prepareDictation() {
    if (this.mode === "menu") {
      this.setChatSearchOrigin();
      this.inputPurpose = "chats";
    } else if (this.mode === "thread") {
      const source = this.messages[this.messageIndex];
      this.setComposeTarget(source);
      if (source && this.messageLines(source).length <= 5)
        void this.queueAck(source);
    } else if (this.mode === "quick") {
      this.setComposeTarget(this.quick!.source);
    } else {
      this.inputPurpose = "compose";
    }
  }
  private setChatSearchOrigin() {
    if (this.menu?.title === "Chats")
      this.chatSearchOrigin = this.menu.rows[this.menu.index]?.chatId;
  }
  async startSearch(purpose: "chats" | "messages") {
    if (!this.voiceEnabled) return;
    this.inputPurpose = purpose;
    if (purpose === "chats") this.setChatSearchOrigin();
    if (purpose === "messages" && !this.query)
      this.searchOrigin = this.messages[this.messageIndex]?.id;
    await this.record();
  }
  async dictateNew() {
    if (!this.chat || this.chat.kind === "channel" || !this.voiceEnabled)
      return;
    this.setComposeTarget();
    await this.record();
  }
  async selectShortcut(id: number) {
    if (
      this.busy ||
      !this.active ||
      !this.frame.shortcuts?.some((item) => item.id === id)
    )
      return;
    this.busy = true;
    try {
      switch (id) {
        case 1:
          this.chatList("", false, this.chat?.id);
          break;
        case 2:
          await this.startSearch("chats");
          break;
        case 3:
          await this.dictateNew();
          break;
        case 4:
          await this.startSearch("messages");
          break;
        case 5: {
          const source =
            this.mode === "thread"
              ? this.messages[this.messageIndex]
              : this.reply;
          if (source) await this.openMessageActions(source);
          break;
        }
        case 7: {
          const next = await this.nextUnreadChat();
          if (next)
            await this.openChat(next, "", undefined, undefined, () =>
              this.chatList("", true, next.id),
            );
          else
            this.notice("You’re caught up", "No other unread chats.", () =>
              this.thread(),
            );
          break;
        }
        case 8:
          await this.openSaved();
          break;
        case 9:
          await this.catchup();
          break;
        case 10:
          this.connection();
          break;
        case 11:
          this.inputPurpose = "compose";
          await this.record();
          break;
      }
    } finally {
      this.busy = false;
    }
  }
  read(
    title: string,
    text: string,
    icon: string,
    next: () => void | Promise<void>,
    back: Back,
    options: {
      context?: string;
      badge?: string;
      action?: string;
      startPage?: number;
    } = {},
  ) {
    this.mode = "read";
    this.actionGuardUntil = 0;
    this.menu = undefined;
    this.readContext = options.context;
    this.readBadge = options.badge;
    this.readAction = options.action ?? "Continue";
    this.readTitle = title;
    this.reading = text;
    this.readIcon = icon;
    this.page = options.startPage ?? 0;
    this.onRead = async () => {
      await next();
    };
    this.onReadBack = async () => {
      await back();
    };
    this.drawRead();
  }
  readPageSize() {
    return this.readContext ? 5 : 6;
  }
  drawRead() {
    const lines = wrap(this.reading);
    const size = this.readPageSize();
    const total = Math.max(1, Math.ceil(lines.length / size));
    this.emit({
      title: this.readTitle,
      badge: total > 1 ? this.page + 1 + " / " + total : this.readBadge,
      context: this.readContext,
      body: lines.slice(this.page * size, (this.page + 1) * size).join("\n"),
      icon: this.readIcon,
      shortcuts:
        this.voiceEnabled &&
        this.readIcon === "send" &&
        this.readAction === "Send now"
          ? [shortcut.redictate]
          : [],
      footer:
        this.page < total - 1
          ? "Tap  Next page     Double tap  Back"
          : "Tap  " +
            this.readAction +
            "     Double tap  " +
            (this.readAction === "Send now" && this.voiceEnabled
              ? "Back · Hold  Dictate again"
              : "Back"),
    });
  }
  async acknowledge(message: Source) {
    const id = message.chatId;
    const chat =
      this.chat?.id === id ? this.chat : this.chats.find((c) => c.id === id);
    const through = Math.max(chat?.readMaxId ?? 0, this.readThrough.get(id) ?? 0);
    if (message.outgoing || message.id <= through) return;
    try {
      await this.api("/glasses/chats/" + encodeURIComponent(id) + "/read", {
        messageId: message.id,
      });
      const row = this.chats.find((item) => item.id === id);
      if (row) {
        const previous = Math.max(
          row.readMaxId,
          through,
          this.readThrough.get(id) ?? 0,
        );
        if (message.id > previous) {
          row.unread = Math.max(
            0,
            row.unread -
              this.messages.filter(
                (item) =>
                  item.chatId === id &&
                  !item.outgoing &&
                  item.id > previous &&
                  item.id <= message.id,
              ).length,
          );
          row.readMaxId = message.id;
        }
      }
      this.readThrough.set(
        id,
        Math.max(this.readThrough.get(id) ?? 0, message.id),
      );
    } catch {
      // Read acknowledgements are best-effort; the user can still act on the source.
    }
  }
  async openMessageActions(message: Source) {
    const back =
      this.mode === "quick" ? () => this.drawQuickReply() : () => this.thread();
    if (!message.revision) {
      const chat = this.chat!;
      await this.openChat(chat, this.query, message.id);
      message = this.messages.find((item) => item.id === message.id) ?? message;
      if (!message.revision)
        throw new Error("Refresh this chat and try again.");
    }
    this.messageActions(message, back);
    await this.queueAck(message);
  }
  async readMessage(message = this.messages[this.messageIndex]) {
    if (!message) return;
    const channel = this.chat!.kind === "channel";
    const next = async () => {
      if (channel) this.messageActions(message);
      else if (!message.revision) await this.openMessageActions(message);
      else await this.quickReply(message);
      void this.queueAck(message);
    };
    if (this.messageLines(message).length <= 5) return next();
    this.read(
      this.chat!.title,
      message.text,
      "message",
      next,
      () => this.thread(),
      {
        context: message.sender,
        action: channel ? "Actions" : "Reply",
        startPage: 1,
      },
    );
  }
  messageActions(m: Source, back: Back = () => this.thread(), index = 0) {
    this.reply = m;
    const returnToActions = () => {
      const selected = this.menu?.index ?? 0;
      return () => this.messageActions(m, back, selected);
    };
    this.showMenu(
      "Message actions",
      "message",
      [
        ...(this.chat!.kind !== "channel"
          ? [
              {
                label: "Reply",
                detail: short(m.text, 40),
                run: () => this.quickReply(m),
              },
              ...(this.voiceEnabled
                ? [
                    {
                      label: "Dictate new message",
                      detail: "Send without a reply link.",
                      run: () => this.dictateNew(),
                    },
                  ]
                : []),
            ]
          : []),
        {
          label: "React",
          detail: "Thumbs up · heart · check",
          run: () => this.reactions(m, returnToActions()),
        },
        {
          label: "Save message",
          detail: "Forward to your Saved Messages",
          run: () =>
            this.review(
              { kind: "save", chatId: m.chatId, messageId: m.id },
              m.revision,
              returnToActions(),
            ),
        },
        ...(m.replyTo
          ? [
              {
                label: "Read original message",
                detail: "Reply context #" + m.replyTo,
                run: async () => {
                  let parent = this.messages.find((p) => p.id === m.replyTo);
                  if (!parent) {
                    const d = await this.api(
                      "/glasses/chats/" +
                        encodeURIComponent(m.chatId) +
                        "/messages?before=" +
                        (m.replyTo! + 1),
                    );
                    parent = d.messages.find((p: Source) => p.id === m.replyTo);
                  }
                  if (!parent) throw new Error("Original message unavailable.");
                  const itemIndex = this.menu?.index ?? 0;
                  this.read(
                    parent.sender + " · Original",
                    parent.text,
                    "reply",
                    () => this.messageActions(m, back, itemIndex),
                    () => this.messageActions(m, back, itemIndex),
                  );
                },
              },
            ]
          : []),
        ...(this.voiceEnabled
          ? [
              {
                label: "Search this chat",
                detail: "Say what to find.",
                run: () => this.startSearch("messages"),
              },
            ]
          : []),
        { label: "Back to conversation", run: () => this.thread() },
      ],
      back,
      index,
      { context: short(m.sender + " · " + m.text.replace(/\s+/g, " "), 41) },
    );
  }
  reactions(m: Source, back: Back) {
    this.showMenu(
      "React",
      "heart",
      [
        ["Thumbs up", "👍"],
        ["Heart", "❤️"],
        ["Check", "✅"],
      ].map(([label, reaction]) => ({
        label,
        run: () =>
          this.review(
            { kind: "react", chatId: m.chatId, messageId: m.id, reaction },
            m.revision,
            () => this.reactions(m, back),
          ),
      })),
      back,
      0,
      {
        native: true,
        context: short(m.sender + " · " + m.text.replace(/\s+/g, " "), 41),
        footer: "Swipe  Choose    Tap  Review    Double tap  Back",
      },
    );
  }
  draftKey() {
    return JSON.stringify([this.chat?.id, this.reply?.id ?? 0]);
  }
  setDraft(text: string) {
    this.draft = text;
    if (text) this.drafts.set(this.draftKey(), text);
    else this.drafts.delete(this.draftKey());
  }
  setComposeTarget(source?: Source) {
    this.reply = source;
    this.draft = this.drafts.get(this.draftKey()) ?? "";
    this.inputPurpose = "compose";
  }
  private replyIdeas(source: Source) {
    const key = JSON.stringify([source.chatId, source.id, source.revision]);
    let request = this.ideas.get(key);
    if (!request) {
      request = this.api(
        "/glasses/chats/" + encodeURIComponent(source.chatId) + "/reply-ideas",
        {
          messageId: source.id,
          revision: source.revision,
        },
      )
        .then((result) =>
          Array.isArray(result.replies)
            ? result.replies.filter(
                (item: unknown): item is string =>
                  typeof item === "string" && !!item.trim(),
              )
            : [],
        )
        .catch(() => []);
      this.ideas.set(key, request);
      if (this.ideas.size > 24)
        this.ideas.delete(this.ideas.keys().next().value!);
      void request.then((replies) => {
        if (!replies.length && this.ideas.get(key) === request)
          this.ideas.delete(key);
      });
    }
    return request;
  }
  async quickReply(source: Source) {
    this.setComposeTarget(source);
    const existing = this.draft ? [{ text: this.draft }] : [];
    const fallback = replyChoices(source).map(([, text]) => ({ text }));
    const quick = {
      source,
      choices: [
        ...existing,
        ...fallback.filter((choice) => choice.text !== this.draft),
      ],
      index: 0,
    };
    this.quick = quick;
    const request =
      this.replyIdeasEnabled && !source.outgoing && source.text.trim()
        ? this.replyIdeas(source)
        : undefined;
    let initial: string[] = [];
    if (request && !existing.length) {
      // Stay on the source briefly. An API timeout must not delay the built-in replies.
      initial = await Promise.race([
        request,
        new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 750)),
      ]);
      if (initial.length)
        quick.choices = [
          ...initial.map((text) => ({ text, ai: true })),
          ...fallback.filter((choice) => !initial.includes(choice.text)),
        ];
    }
    this.drawQuickReply();
    if (request && !initial.length)
      void request.then((replies) => {
        if (this.quick !== quick || !replies.length) return;
        const oldText = quick.choices.map((choice) => choice.text);
        quick.choices.push(
          ...replies
            .filter((text) => !oldText.includes(text))
            .map((text) => ({ text, ai: true })),
        );
        // Keep the visible choice and confirmation stable; the next swipe reveals new ideas.
      });
  }
  drawQuickReply() {
    const quick = this.quick!;
    const choice = quick.choices[quick.index];
    const lines = wrap(choice.text);
    this.mode = "quick";
    this.menu = undefined;
    this.emit({
      title: "Reply · " + this.chat!.title,
      icon: "send",
      badge:
        (choice.ai ? "AI " : "") +
        (quick.index + 1) +
        " / " +
        quick.choices.length,
      context: fitLine(
        quick.source.sender +
          ": " +
          (quick.source.text || "[media]").replace(/\s+/g, " "),
        525,
      ),
      body: lines.slice(0, 5).join("\n"),
      footer:
        "Swipe  Ideas    Tap  Review" +
        (this.voiceEnabled ? "    Hold  Dictate" : "    Double tap  Back"),
      shortcuts: [shortcut.messageActions],
    });
  }
  private stageAction(action: PersonalAction, revision: string) {
    this.pending = action;
    this.pendingRevision = revision;
    this.operationId = crypto.randomUUID();
  }
  private replyAction(text: string): PersonalAction {
    return {
      kind: this.reply ? "reply" : "send",
      chatId: this.chat!.id,
      messageId: this.reply?.id ?? 0,
      text,
    };
  }
  async confirmQuickReply() {
    const quick = this.quick!;
    this.setComposeTarget(quick.source);
    const text = quick.choices[quick.index].text;
    this.setDraft(text);
    const action = this.replyAction(text);
    // Always go through review - no instant sends (Designer fix #2)
    this.review(action, quick.source.revision, () => this.drawQuickReply());
  }
  async voiceText(text: string) {
    if (this.inputPurpose === "chats") {
      this.chatList(text.trim().slice(0, 120));
      return;
    }
    if (this.inputPurpose === "messages") {
      await this.openChat(this.chat!, text.trim().slice(0, 120));
      return;
    }
    this.setDraft(text);
    const back =
      this.mode === "quick" && this.quick?.source.id === this.reply?.id
        ? () => this.quickReply(this.reply!)
        : () => this.thread();
    this.review(this.replyAction(text), this.reply?.revision ?? "", back);
  }
  review(
    action: PersonalAction,
    revision: string,
    cancel: Back = () => this.thread(),
  ) {
    this.stageAction(action, revision);
    const destination =
      action.kind === "save" ? "Saved Messages" : this.chat!.title;
    const actionLabel =
      action.kind === "react"
        ? "React"
        : action.kind === "save"
          ? "Save"
          : "Send";
    const source = this.reply?.id === action.messageId ? this.reply : undefined;
    const quote = source?.text.replace(/\s+/g, " ");
    const reaction =
      action.reaction === "👍"
        ? "Thumbs up"
        : action.reaction === "❤️"
          ? "Heart"
          : "Check";
    this.read(
      actionLabel + " · " + destination,
      action.text ??
        (action.kind === "react" ? reaction + "\n\n" : "") +
          (source?.text ?? ""),
      "send",
      () => this.send(cancel),
      cancel,
      {
        badge: this.synthetic ? "DEMO" : "REVIEW",
        context: source
          ? short("Re " + source.sender + ": " + quote, 41)
          : "New message",
        action: actionLabel === "Send" ? "Send now" : actionLabel + " now",
      },
    );
    // The tap that opened review must not also confirm it.
    this.actionGuardUntil = this.now() + 1000;
  }
  async send(cancel: Back = () => this.thread()) {
    const action = this.pending!;
    let result;
    try {
      result = await this.api("/glasses/action", {
        confirmed: true,
        operationId: this.operationId,
        action,
        revision: this.pendingRevision,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 401) throw error;
      if (status === 409) {
        this.notice("Source needs review", (error as Error).message, () =>
          this.openChat(this.chat!, this.query, action.messageId),
        );
        return;
      }
      if (status === 400) {
        this.notice("Action was declined", (error as Error).message, cancel);
        return;
      }
      this.notice(
        "DELIVERY UNVERIFIED",
        "Check Telegram before sending again.\nNo automatic retry was made.\nYour draft remains available.",
        () => this.thread(),
      );
      return;
    }
    if (result.status !== "sent") {
      this.notice(
        "DELIVERY UNCERTAIN",
        "Check Telegram before sending again.\nNo automatic retry was made.",
        () => this.thread(),
      );
      return;
    }
    const outgoing = action.kind === "reply" || action.kind === "send";
    if (outgoing) this.setDraft("");
    const messageId = result.result?.messageId;
    if (
      outgoing &&
      Number.isSafeInteger(messageId) &&
      messageId > 0 &&
      !this.query
    ) {
      // The write receipt gives us the exact text and server ID without another network trip.
      const confirmed: Source = {
        id: messageId,
        chatId: action.chatId,
        sender: "You",
        outgoing: true,
        text: action.text!,
        date: Date.now(),
        replyTo: action.kind === "reply" ? action.messageId : undefined,
        revision: result.result.revision ?? "",
      };
      this.messages = this.messages
        .filter((message) => message.id !== messageId)
        .concat(confirmed);
      this.messageIndex = this.messages.length - 1;
    }
    const status = outgoing
      ? "Sent"
      : action.kind === "save"
        ? "Saved"
        : "Reacted";
    await this.thread((this.synthetic ? "Demo " : "") + status);
  }
  async catchup() {
    const d = await this.api("/brief");
    this.cards = d.cards;
    this.showMenu(
      "Catch-up",
      "spark",
      [
        ...this.cards.map((c) => ({
          label: c.title,
          detail: c.evidence[0].chatTitle + " · " + c.kind,
          run: async () => {
            const e = c.evidence[0],
              chat = this.chats.find((c) => c.id === e.chatId);
            if (chat)
              this.read(
                c.title,
                c.why +
                  "\n\n" +
                  c.evidence
                    .map(
                      (e) =>
                        e.chatTitle +
                        " / " +
                        e.sender +
                        " #" +
                        e.messageId +
                        "\n" +
                        e.quote,
                    )
                    .join("\n\n"),
                "spark",
                () =>
                  this.openChat(chat, "", e.messageId, undefined, () =>
                    this.catchup(),
                  ),
                () => this.catchup(),
              );
          },
        })),
        {
          label: "Catch-up chats",
          detail: "Choose up to 10 here",
          run: () => this.watchlist(0, () => this.catchup()),
        },
        {
          label: "Mark caught up",
          detail: "Start a new catch-up window",
          run: async () => {
            await this.api("/checkpoint", {});
            await this.catchup();
          },
        },
      ],
      () => this.home(),
    );
  }
  watchlist(index = 0, back?: Back) {
    this.showMenu(
      "Catch-up chats",
      "check",
      this.chats.map((c, i) => ({
        label: (this.watched.includes(c.id) ? "[x] " : "[ ] ") + c.title,
        detail:
          "Tap to " + (this.watched.includes(c.id) ? "remove" : "include"),
        run: async () => {
          const ids = this.watched.includes(c.id)
            ? this.watched.filter((id) => id !== c.id)
            : [...this.watched, c.id];
          const d = await this.api("/watch", { ids });
          this.watched = d.watched;
          this.watchlist(i, back);
        },
      })),
      back ?? (() => this.home()), // Designer fix #7
      index,
      { badge: this.watched.length + " / 10" },
    );
  }
  connection() {
    this.showMenu(
      "Settings",
      "glasses",
      [
        {
          label: this.synthetic ? "Demo server" : "Telegram server", // Designer fix #8
          detail: this.synthetic
            ? "Connected · Synthetic data"
            : "Connected · Your account",
          run: () =>
            this.notice(
              "SERVER",
              this.synthetic
                ? "Synthetic data. No Telegram account connected."
                : "Personal Telegram account session is stored on your server.\nThe phone hosts Even Hub and handles setup.",
              () => this.connection(),
            ),
        },
        {
          label: "Controls",
          detail: "Swipe · tap · double · hold",
          run: () =>
            this.notice(
              "GLASSES CONTROLS",
              "Swipe to move. Tap to open.\nHold a message to dictate a reply.\nHold in Chats to find a chat.\nDouble tap to go back.\nTap then hold for shortcuts.",
              () => this.connection(),
            ),
        },
        {
          label: "Catch-up chats",
          detail: "Choose which chats appear in Catch-up.",
          run: () => this.watchlist(0, () => this.connection()),
        },
        {
          label: "Disconnect display", // Designer fix #8
          detail: "Revoke server access",
          run: () =>
            // Tap disconnects; Double tap (Back) returns to Settings.
            this.confirm(
              "DISCONNECT?",
              "The glasses will need a new pairing code after disconnect.",
              "Disconnect now",
              async () => {
                await this.api("/logout", {});
                this.disconnected();
              },
              () => this.connection(),
            ),
        },
      ],
      () => this.home(),
    );
  }
  /** Informational screen: Tap and Double tap both continue. */
  notice(title: string, text: string, next: () => void | Promise<void>) {
    this.read(title, text, "info", next, next);
  }
  /** Confirmation: only Tap runs the action; Double tap (Back) cancels. */
  confirm(
    title: string,
    text: string,
    action: string,
    run: () => void | Promise<void>,
    cancel: Back,
  ) {
    this.read(title, text, "info", run, cancel, { action });
  }
  async input(event: Input, nativeIndex?: number) {
    if (this.busy || !this.active) return;
    this.busy = true;
    try {
      if (nativeIndex !== undefined && !this.menu?.native) return;
      if (this.mode === "menu") {
        const m = this.menu!;
        if (event === "back") await m.back();
        else if (event === "tap") {
          await m.rows[nativeIndex ?? m.index]?.run();
        } else {
          m.index = Math.max(
            0,
            Math.min(m.rows.length - 1, m.index + (event === "down" ? 1 : -1)),
          );
          this.drawMenu();
        }
      } else if (this.mode === "quick") {
        const quick = this.quick!;
        if (event === "back") {
          if (!this.draft) this.setDraft(quick.choices[quick.index].text);
          await this.thread();
        } else if (event === "tap") await this.confirmQuickReply();
        else {
          quick.index =
            (quick.index + (event === "up" ? -1 : 1) + quick.choices.length) %
            quick.choices.length;
          this.drawQuickReply();
        }
      } else if (this.mode === "thread") {
        if (event === "back") {
          if (this.query)
            await this.openChat(this.chat!, "", this.searchOrigin);
          else await this.threadBack();
        } else if (event === "tap") {
          if (this.messageIndex < 0)
            await this.openChat(
              this.chat!,
              this.query,
              undefined,
              this.messages[0]?.id,
            );
          else if (this.messageIndex >= this.messages.length)
            await this.dictateNew();
          else await this.readMessage();
        } else if (
          event === "down" &&
          !this.query &&
          this.messages.length > 0 &&
          this.messageIndex >= this.messages.length - 1
        ) {
          await this.continueToNextUnread();
        } else {
          this.messageIndex = Math.max(
            this.hasOlder ? -1 : 0,
            Math.min(
              this.messages.length,
              this.messageIndex + (event === "down" ? 1 : -1),
            ),
          );
          await this.thread();
        }
      } else if (this.mode === "read") {
        const max = Math.max(
          0,
          Math.ceil(wrap(this.reading).length / this.readPageSize()) - 1,
        );
        if (event === "back") await this.onReadBack();
        else if (event === "tap" && this.page === max) {
          if (this.now() < this.actionGuardUntil) return;
          await this.onRead();
        }
        else {
          this.page = Math.max(
            0,
            Math.min(max, this.page + (event === "up" ? -1 : 1)),
          );
          this.drawRead();
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
