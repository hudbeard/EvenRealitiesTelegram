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
  editDraft: { id: 6, label: "Edit draft" },
  nextUnread: { id: 7, label: "Next unread chat" },
  keyboardDone: { id: 8, label: "Finish typing" },
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
  composeFocus = 0;
  readContext?: string;
  readBadge?: string;
  readAction = "Continue";
  threadBack: Back = () => this.chatList();
  inputBack: Back = () => this.chatList();
  drafts = new Map<string, string>();
  lastChatId?: string;
  private lastMessageByChat = new Map<string, number>();
  private searchOrigin?: number;
  private readThrough = new Map<string, number>();
  inputPurpose: "compose" | "chats" | "messages" = "compose";
  inputText = "";
  uppercase = false;
  pending?: PersonalAction;
  operationId = "";
  pendingRevision = "";
  cards: BriefCard[] = [];
  constructor(
    public api: Request,
    public changed: (frame: Frame) => void,
    public exit: () => Promise<void> = async () => {},
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
      menu.icon === "keyboard"
        ? menu.native
          ? []
          : [shortcut.keyboardDone]
        : ["telegram", "chats"].includes(menu.icon)
          ? [shortcut.findChat]
          : menu.icon === "compose"
            ? [shortcut.editDraft, shortcut.messageActions].filter(
                (item) => item !== shortcut.messageActions || this.reply,
              )
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
    await this.home();
  }
  async refresh() {
    const d = await this.api("/glasses/dialogs");
    this.chats = d.chats;
    this.watched = d.watched;
  }
  async home() {
    await this.refresh();
    const unread = this.chats.filter((chat) => chat.unread);
    const last = this.chats.find((chat) => chat.id === this.lastChatId);
    this.showMenu(
      "Telegram",
      "telegram",
      [
        ...(unread.length
          ? [
              {
                label: "Unread",
                detail:
                  unread.reduce((sum, chat) => sum + chat.unread, 0) +
                  " new messages in " +
                  unread.length +
                  (unread.length === 1 ? " chat" : " chats"),
                run: () => this.chatList("", true),
              },
            ]
          : []),
        {
          label: "All chats",
          detail: this.chats.length + " conversations",
          run: () => this.chatList(),
        },
        ...(last
          ? [
              {
                label: "Resume chat",
                preview: last.title,
                detail: "Return to the conversation you last opened.",
                run: () =>
                  this.openChat(
                    last,
                    "",
                    this.lastMessageByChat.get(last.id),
                    undefined,
                    () => this.home(),
                  ),
              },
            ]
          : []),
        {
          label: "Catch-up",
          detail: "See what changed and who needs a reply.",
          run: () => this.catchup(),
        },
        {
          label: "Saved Messages",
          detail: "Open your personal Telegram notebook.",
          run: async () => {
            const saved = await this.api("/glasses/saved");
            await this.openChat(saved, "", undefined, undefined, () =>
              this.home(),
            );
          },
        },
        {
          label: "Catch-up chats",
          detail: this.watched.length + " of 10 selected",
          run: () => this.watchlist(),
        },
        {
          label: "Settings",
          detail: "Controls, connection and sign out",
          run: () => this.connection(),
        },
      ],
      () => this.exit(),
      0,
      {
        badge: this.synthetic ? "DEMO" : "ONLINE",
        footer: "Swipe  Select     Tap  Open     Double tap  Exit",
      },
    );
  }
  chatList(filter = "", unreadOnly = false, focusId?: string) {
    const matches = this.chats.filter(
      (chat) =>
        (!unreadOnly || chat.unread > 0 || chat.id === focusId) &&
        chat.title.toLowerCase().includes(filter.toLowerCase()),
    );
    const backToList = (id?: string) => this.chatList(filter, unreadOnly, id);
    this.showMenu(
      filter ? "Chat search" : unreadOnly ? "Unread chats" : "All chats",
      "chats",
      [
        ...matches.map((chat) => ({
          label: (chat.unread ? "● " : "") + chat.title,
          preview: chat.title,
          detail:
            (chat.kind === "dm"
              ? "Direct message"
              : chat.kind === "group"
                ? "Group"
                : "Channel") +
            "\n" +
            (chat.unread ? chat.unread + " unread" : "Up to date") +
            (chat.preview ? "\n" + chat.preview.replace(/\s+/g, " ") : ""),
          run: () =>
            this.openChat(chat, "", undefined, undefined, () =>
              backToList(chat.id),
            ),
        })),
        {
          label: "Find a conversation",
          detail: "Search by chat name using the glasses keyboard.",
          run: () => this.startInput("chats", backToList),
        },
        ...(filter || unreadOnly
          ? [
              {
                label: "Show all chats",
                detail: "Return to the complete inbox.",
                run: () => this.chatList(),
              },
            ]
          : []),
        {
          label: "Refresh",
          detail: "Check for new conversations and unread messages.",
          run: async () => {
            await this.refresh();
            backToList(focusId);
          },
        },
      ],
      () => this.home(),
      Math.max(
        0,
        matches.findIndex((chat) => chat.id === focusId),
      ),
      {
        context: filter
          ? "Results for “" +
            short(filter, 30) +
            "” · " +
            matches.length +
            " found"
          : undefined,
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
    this.lastChatId = chat.id;
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
  async thread() {
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
        body:
          (total
            ? "End of conversation"
            : "No messages" + (this.query ? " match your search" : "")) +
          "\n\n> Conversation options\n  Write · search · refresh",
        footer: "Tap  Options     Double tap  Back",
        shortcuts: this.threadShortcuts(),
      });
      return;
    }
    if (!this.query) this.lastMessageByChat.set(c.id, m.id);
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
        "Swipe  Move   Tap  " + action + "   Double  Back   Tap+hold  Menu",
      shortcuts: this.threadShortcuts(m, lines.length <= 5),
    });
  }
  messageLines(message: Source) {
    return wrap(
      message.text || "[" + (message.media ?? "Media") + " · view in Telegram]",
    );
  }
  threadShortcuts(message?: Source, fullyVisible = false) {
    return [
      ...(message && fullyVisible ? [shortcut.messageActions] : []),
      ...(this.chat?.kind !== "channel" ? [shortcut.newMessage] : []),
      shortcut.findMessage,
      shortcut.nextUnread,
      shortcut.inbox,
    ];
  }
  canDictate() {
    return this.mode === "thread"
      ? this.voiceEnabled &&
          !!this.chat &&
          this.chat.kind !== "channel" &&
          !!this.messages[this.messageIndex] &&
          this.messageLines(this.messages[this.messageIndex]).length <= 5
      : (this.mode === "read" && this.readIcon === "mic") ||
          (this.mode === "menu" &&
            ["compose", "keyboard"].includes(this.menu?.icon ?? ""));
  }
  prepareDictation() {
    if (this.mode === "thread") {
      this.compose(this.messages[this.messageIndex], true);
    }
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
          this.startInput("chats", () => this.chatList());
          break;
        case 3:
          this.compose(undefined, true);
          break;
        case 4:
          this.startInput("messages");
          break;
        case 5: {
          const source =
            this.mode === "thread"
              ? this.messages[this.messageIndex]
              : this.reply;
          if (source) await this.openMessageActions(source);
          break;
        }
        case 6:
          this.editDraft();
          break;
        case 7: {
          await this.refresh();
          const next = this.chats.find(
            (chat) => chat.unread > 0 && chat.id !== this.chat?.id,
          );
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
          await this.finishInput();
          break;
      }
    } finally {
      this.busy = false;
    }
  }
  conversationOptions() {
    this.showMenu(
      this.chat!.title + " · Options",
      "message",
      [
        ...(this.chat!.kind !== "channel"
          ? [
              {
                label: "Write a new message",
                detail: "Compose on your glasses",
                run: () => this.compose(),
              },
            ]
          : []),
        {
          label: "Search messages",
          detail: "Find text in this conversation",
          run: () => this.startInput("messages"),
        },
        {
          label: this.query ? "Clear search" : "Refresh conversation",
          detail: "Fetch latest messages",
          run: () => this.openChat(this.chat!),
        },
        { label: "Back to messages", run: () => this.thread() },
      ],
      () => this.thread(),
    );
  }
  read(
    title: string,
    text: string,
    icon: string,
    next: () => void | Promise<void>,
    back: Back,
    options: { context?: string; badge?: string; action?: string } = {},
  ) {
    this.mode = "read";
    this.menu = undefined;
    this.readContext = options.context;
    this.readBadge = options.badge;
    this.readAction = options.action ?? "Continue";
    this.readTitle = title;
    this.reading = text;
    this.readIcon = icon;
    this.page = 0;
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
      footer:
        this.page < total - 1
          ? "Tap  Next page     Double tap  Back"
          : "Tap  " +
            this.readAction +
            "     Double tap  " +
            (this.readAction === "Send now" ? "Edit / cancel" : "Back"),
    });
  }
  async acknowledge(message: Source) {
    const chat = this.chat!;
    if (
      message.outgoing ||
      message.id <= Math.max(chat.readMaxId, this.readThrough.get(chat.id) ?? 0)
    )
      return;
    try {
      await this.api(
        "/glasses/chats/" + encodeURIComponent(message.chatId) + "/read",
        { messageId: message.id },
      );
      const row = this.chats.find((item) => item.id === chat.id);
      if (row) {
        const previous = Math.max(
          row.readMaxId,
          chat.readMaxId,
          this.readThrough.get(chat.id) ?? 0,
        );
        row.unread = Math.max(
          0,
          row.unread -
            this.messages.filter(
              (item) =>
                !item.outgoing && item.id > previous && item.id <= message.id,
            ).length,
        );
        row.readMaxId = message.id;
      }
      this.readThrough.set(chat.id, message.id);
    } catch {
      // Read acknowledgements are best-effort; the user can still act on the source.
    }
  }
  async openMessageActions(message: Source) {
    const back =
      this.mode === "menu" && this.menu?.icon === "compose"
        ? () => this.composeMenu()
        : () => this.thread();
    this.messageActions(message, back);
    await this.acknowledge(message);
  }
  async readMessage(message = this.messages[this.messageIndex]) {
    if (!message) return;
    const channel = this.chat!.kind === "channel";
    const next = async () => {
      if (channel) this.messageActions(message);
      else this.compose(message, true);
      await this.acknowledge(message);
    };
    if (this.messageLines(message).length <= 5) return next();
    this.read(
      this.chat!.title,
      message.text,
      "message",
      next,
      () => this.thread(),
      { context: message.sender, action: channel ? "Actions" : "Reply" },
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
                run: () => this.compose(m),
              },
              {
                label: "Write a new message",
                detail: "Send without a reply link",
                run: () => this.compose(),
              },
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
        {
          label: "Search this chat",
          detail: "Find older messages on glasses",
          run: () => this.startInput("messages", returnToActions()),
        },
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
  compose(reply?: Source, direct = false) {
    if (!this.chat || this.chat.kind === "channel") return;
    this.reply = reply;
    this.draft = this.drafts.get(this.draftKey()) ?? "";
    this.inputPurpose = "compose";
    this.composeFocus = 0;
    this.composeMenu();
    // A text-only installation still has a one-tap path to type a new message.
    if (direct && !reply && !this.draft && !this.voiceEnabled) this.editDraft();
  }
  editDraft() {
    this.inputPurpose = "compose";
    this.inputText = this.draft;
    this.uppercase = false;
    this.keyboard();
  }
  reviewDraft() {
    const text = this.draft;
    if (!text.trim()) return this.editDraft();
    if (text.length > 4096)
      throw new Error("The draft exceeds Telegram’s 4,096-character limit.");
    this.review(
      {
        kind: this.reply ? "reply" : "send",
        chatId: this.chat!.id,
        messageId: this.reply?.id ?? 0,
        text,
      },
      this.reply?.revision ?? "",
    );
  }
  composeMenu() {
    const source = this.reply;
    const suggestions = source && !source.outgoing ? replyChoices(source) : [];
    this.showMenu(
      (source ? "Reply · " : "New message · ") + this.chat!.title,
      "compose",
      [
        ...(this.draft
          ? [
              {
                label: "Review draft",
                detail: this.draft,
                run: () => this.reviewDraft(),
              },
            ]
          : []),
        ...suggestions.map(([label, text]) => ({
          label,
          preview: "Reply preview",
          detail: text,
          run: () => {
            this.setDraft(text);
            this.composeFocus = 0;
            this.reviewDraft();
          },
        })),
        {
          label: this.draft
            ? "Edit draft"
            : source
              ? "Type a reply"
              : "Type a message",
          detail: "Enter your own words with the glasses keyboard.",
          run: () => this.editDraft(),
        },
        ...(this.voiceEnabled
          ? [
              {
                label: "Dictate",
                detail:
                  "Hold the ring or touchpad to speak. Release to review your transcript.",
                run: () =>
                  this.read(
                    "Dictate",
                    "Hold to speak. Release for a draft.",
                    "mic",
                    () => this.composeMenu(),
                    () => this.composeMenu(),
                  ),
              },
            ]
          : []),
        ...(!source
          ? []
          : [
              {
                label: "More actions",
                detail: "React, save, read the original, or search this chat.",
                run: () =>
                  this.messageActions(source, () => this.composeMenu()),
              },
            ]),
        ...(this.draft
          ? [
              {
                label: "Discard draft",
                detail: "Clear the text for this message.",
                run: () => {
                  this.setDraft("");
                  this.composeFocus = 0;
                  this.composeMenu();
                },
              },
            ]
          : []),
      ],
      () => this.thread(),
      this.composeFocus,
      {
        context: source
          ? short(source.sender + " · " + source.text.replace(/\s+/g, " "), 42)
          : undefined,
        badge: this.draft ? "DRAFT" : undefined,
        footer: this.voiceEnabled
          ? "Swipe  Choose     Tap  Open     Hold  Dictate"
          : undefined,
      },
    );
  }
  startInput(purpose: "chats" | "messages", back: Back = () => this.thread()) {
    this.inputPurpose = purpose;
    if (purpose === "messages" && !this.query)
      this.searchOrigin = this.messages[this.messageIndex]?.id;
    this.inputBack = back;
    this.inputText = "";
    this.uppercase = false;
    this.keyboard();
  }
  keyboard() {
    this.showMenu(
      this.inputPurpose === "compose" ? "Keyboard" : "Search keyboard",
      "keyboard",
      [
        ...(this.inputText.trim()
          ? [
              {
                label:
                  this.inputPurpose === "compose" ? "Done typing" : "Search",
                detail: this.inputText.length + " characters",
                run: () => this.finishInput(),
              },
            ]
          : []),
        ...[
          "ABCDEF",
          "GHIJKL",
          "MNOPQR",
          "STUVWX",
          "YZ0123",
          "456789",
          ".,?!'-",
        ].map((group) => ({
          label: group.split("").join(" "),
          detail: "Choose a letter group",
          run: () => this.letters(group),
        })),
        {
          label: this.uppercase ? "Lowercase letters" : "Uppercase letters",
          detail: "Toggle letter case",
          run: () => {
            this.uppercase = !this.uppercase;
            this.keyboard();
          },
        },
        {
          label: "Read current text",
          detail: this.inputText.length + " characters",
          run: () =>
            this.read(
              "Typed text",
              this.inputText || "Empty",
              "keyboard",
              () => this.keyboard(),
              () => this.keyboard(),
            ),
        },
        { label: "Space", run: () => this.append(" ") },
        {
          label: "Backspace",
          run: () => {
            this.inputText = Array.from(this.inputText).slice(0, -1).join("");
            this.keyboard();
          },
        },
      ],
      () => {
        if (this.inputPurpose !== "compose") return this.inputBack();
        this.setDraft(this.inputText);
        this.composeFocus = 0;
        this.composeMenu();
      },
      0,
      {
        badge: this.uppercase ? "ABC" : "abc",
        context: this.inputText
          ? "…" + Array.from(this.inputText).slice(-36).join("") + "▏"
          : "Start typing",
        footer: "Swipe  Choose    Tap  Select    Double tap  Back",
      },
    );
  }
  letters(group: string) {
    this.showMenu(
      "Choose a character",
      "keyboard",
      group.split("").map((letter) => ({
        label: this.uppercase ? letter : letter.toLowerCase(),
        detail: "Add to text",
        run: () => this.append(this.uppercase ? letter : letter.toLowerCase()),
      })),
      () => this.keyboard(),
      0,
      {
        native: true,
        context: this.inputText ? short(this.inputText, 40) : "Start typing",
        footer: "Swipe  Select    Tap  Add    Double tap  Groups",
      },
    );
  }
  append(s: string) {
    const max = this.inputPurpose === "compose" ? 4096 : 120;
    if (this.inputText.length + s.length > max)
      throw new Error("Limit: " + max + " characters.");
    this.inputText += s;
    this.keyboard();
  }
  async finishInput() {
    if (this.inputPurpose === "compose") {
      this.setDraft(this.inputText);
      this.composeFocus = 0;
      this.composeMenu();
    } else if (this.inputPurpose === "chats")
      this.chatList(this.inputText.trim());
    else await this.openChat(this.chat!, this.inputText.trim());
  }
  voiceText(text: string) {
    if (this.inputPurpose === "compose") {
      this.setDraft(text);
      this.composeFocus = 0;
      this.reviewDraft();
    } else {
      this.inputText = text;
      this.read(
        "Search transcript",
        text,
        "keyboard",
        () => this.finishInput(),
        () => this.keyboard(),
        { action: "Search" },
      );
    }
  }
  review(
    action: PersonalAction,
    revision: string,
    cancel: Back = () => this.cancelReview(),
  ) {
    this.pending = action;
    this.pendingRevision = revision;
    this.operationId = crypto.randomUUID();
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
      () => this.send(),
      cancel,
      {
        badge: this.synthetic ? "DEMO" : "REVIEW",
        context: source
          ? short("Re " + source.sender + ": " + quote, 41)
          : "New message",
        action: actionLabel === "Send" ? "Send now" : actionLabel + " now",
      },
    );
  }
  cancelReview() {
    if (this.pending?.kind === "reply" || this.pending?.kind === "send") {
      this.composeFocus = 0;
      this.composeMenu();
    } else if (this.reply) this.messageActions(this.reply);
    else return this.thread();
  }
  async send() {
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
        this.notice("Action was declined", (error as Error).message, () =>
          this.cancelReview(),
        );
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
    if (action.kind === "reply" || action.kind === "send") this.setDraft("");
    this.notice(
      this.synthetic ? "SYNTHETIC DEMO RECEIPT" : "TELEGRAM CONFIRMED",
      (action.kind === "save"
        ? "Saved to Saved Messages."
        : action.kind === "react"
          ? "Reaction applied."
          : "Message sent as you.") +
        (result.result?.messageId
          ? "\nMessage #" + result.result.messageId
          : "") +
        (this.synthetic ? "\nNo real Telegram message was sent." : ""),
      () =>
        this.openChat(
          this.chat!,
          "",
          action.kind === "reply" || action.kind === "send"
            ? result.result?.messageId
            : action.messageId,
        ),
    );
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
          run: () => this.watchlist(),
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
  watchlist(index = 0) {
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
          this.watchlist(i);
        },
      })),
      () => this.home(),
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
          label: this.synthetic
            ? "Demo server connected"
            : "Telegram server connected",
          detail: "Session lives on your backend",
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
              "Swipe to move. Tap to open.\nDouble tap to go back.\nHold to dictate where enabled.\nTap then hold for shortcuts.\nDouble tap at Telegram to exit.",
              () => this.connection(),
            ),
        },
        {
          label: "Disconnect this display",
          detail: "Revoke its server access",
          run: async () => {
            await this.api("/logout", {});
            location.reload();
          },
        },
      ],
      () => this.home(),
    );
  }
  notice(title: string, text: string, next: () => void | Promise<void>) {
    this.read(title, text, "info", next, next);
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
          if (m.icon === "compose") this.composeFocus = m.index;
          await m.rows[nativeIndex ?? m.index]?.run();
        } else {
          m.index = Math.max(
            0,
            Math.min(m.rows.length - 1, m.index + (event === "down" ? 1 : -1)),
          );
          this.drawMenu();
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
            this.conversationOptions();
          else await this.readMessage();
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
        else if (event === "tap" && this.page === max) await this.onRead();
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
