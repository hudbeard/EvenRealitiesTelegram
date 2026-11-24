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
};
export type Input = "up" | "down" | "tap" | "back";
export type Request = (path: string, body?: unknown) => Promise<any>;
type Row = { label: string; detail?: string; run: () => void | Promise<void> };
type Menu = {
  title: string;
  icon: string;
  rows: Row[];
  index: number;
  back: () => void | Promise<void>;
};
export function wrap(text: string, width = 43): string[] {
  const result: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    let current = "";
    for (const word of line.split(/\s+/)) {
      if (!word) continue;
      let rest = word;
      while (rest.length > width) {
        if (current) {
          result.push(current);
          current = "";
        }
        result.push(rest.slice(0, width));
        rest = rest.slice(width);
      }
      if (current.length + rest.length + 1 > width) {
        result.push(current);
        current = rest;
      } else current += (current ? " " : "") + rest;
    }
    result.push(current);
  }
  return result;
}
const short = (s: string, n = 42) =>
  s.length > n ? s.slice(0, n - 1) + "…" : s;
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
  composeBack = async () => {};
  inputPurpose: "compose" | "chats" | "messages" = "compose";
  inputText = "";
  keyboardGroup = "";
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
  ) {
    this.mode = "menu";
    this.menu = {
      title,
      icon,
      rows,
      index: Math.min(index, Math.max(0, rows.length - 1)),
      back,
    };
    this.drawMenu();
  }
  drawMenu() {
    const m = this.menu!;
    const start = Math.floor(m.index / 3) * 3;
    this.emit({
      title: m.title,
      icon: m.icon,
      body: m.rows
        .slice(start, start + 3)
        .map(
          (r, i) =>
            (start + i === m.index ? "> " : "  ") +
            short(r.label, 40) +
            "\n  " +
            short(r.detail ?? "", 40),
        )
        .join("\n"),
      footer: "Swipe: select · Tap: open · Double: back",
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
    this.chat = undefined;
    this.showMenu(
      this.synthetic ? "TELEGRAM / SYNTHETIC DEMO" : "TELEGRAM / FIELDLINE",
      "telegram",
      [
        {
          label: "Chats",
          detail:
            this.chats.reduce((n, c) => n + c.unread, 0) +
            " unread · " +
            this.chats.length +
            " conversations",
          run: () => this.chatList(),
        },
        {
          label: "Catch-up",
          detail: "What changed · who needs you",
          run: () => this.catchup(),
        },
        {
          label: "Saved Messages",
          detail: "Your personal Telegram notebook",
          run: async () => {
            const c = await this.api("/glasses/saved");
            await this.openChat(c);
          },
        },
        {
          label: "Catch-up chats",
          detail: this.watched.length + "/10 selected · manage here",
          run: () => this.watchlist(),
        },
        {
          label: "Connection & controls",
          detail: "Server · gestures · sign out",
          run: () => this.connection(),
        },
      ],
      () => this.exit(),
    );
  }
  chatList(filter = "") {
    this.showMenu(
      filter ? "FIND: " + short(filter, 24) : "CHATS",
      "chats",
      [
        {
          label: "Find a conversation",
          detail: "Type or dictate on glasses",
          run: () => this.startInput("chats"),
        },
        ...this.chats
          .filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
          .map((c) => ({
            label: c.title,
            detail:
              (c.kind === "dm"
                ? "Direct message"
                : c.kind === "group"
                  ? "Group"
                  : "Channel") +
              " · " +
              (c.unread ? c.unread + " unread" : "up to date"),
            run: () => this.openChat(c),
          })),
        {
          label: "Refresh conversations",
          detail: "Get latest unread counts",
          run: async () => {
            await this.refresh();
            this.chatList(filter);
          },
        },
      ],
      () => this.home(),
    );
  }
  async openChat(chat: Chat, search = "", focusId?: number, before?: number) {
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
    this.chat = chat;
    this.messages = d.messages;
    this.hasOlder = d.hasOlder;
    this.query = search;
    let index = focusId
      ? this.messages.findIndex((m) => m.id === focusId)
      : this.messages.findIndex((m) => !m.outgoing && m.id > chat.readMaxId);
    this.messageIndex =
      index < 0 ? Math.max(0, this.messages.length - 1) : index;
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
      () => this.chatList(),
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
        footer: "Swipe: messages · Tap: load · Double: chats",
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
        footer: "Swipe up: messages · Tap: options · Double: chats",
      });
      return;
    }
    const date = new Date(m.date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    this.emit({
      title:
        short(c.title, 30) + " / " + (this.messageIndex + 1) + " of " + total,
      icon: c.kind === "dm" ? "user" : c.kind === "group" ? "users" : "channel",
      body:
        short(m.sender, 30) +
        " · " +
        date +
        (m.outgoing ? " · You" : "") +
        "\n" +
        wrap(
          m.text || "[" + (m.media ?? "Media") + " — open Telegram for media]",
        )
          .slice(0, 4)
          .join("\n") +
        "\n" +
        (m.replyTo ? "↳ Reply to #" + m.replyTo : "Tap to read & act"),
      footer: "Swipe: messages · Tap: read · Double: chats",
    });
  }
  conversationOptions() {
    this.showMenu(
      "CONVERSATION / " + short(this.chat!.title, 24),
      "chats",
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
          label: "Refresh conversation",
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
    back: () => void | Promise<void>,
  ) {
    this.mode = "read";
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
  drawRead() {
    const lines = wrap(this.reading),
      total = Math.max(1, Math.ceil(lines.length / 6));
    this.emit({
      title: short(this.readTitle, 34) + " " + (this.page + 1) + "/" + total,
      body: lines.slice(this.page * 6, this.page * 6 + 6).join("\n"),
      icon: this.readIcon,
      footer:
        this.page < total - 1
          ? "Tap: next page · Double: back"
          : "Tap: continue · Double: back",
    });
  }
  async readMessage(m = this.messages[this.messageIndex]) {
    if (!m) return;
    this.reply = m;
    this.read(
      m.sender + " / " + this.chat!.title,
      m.text || "[" + (m.media ?? "Media") + "]",
      "message",
      async () => {
        await this.api(
          "/glasses/chats/" + encodeURIComponent(m.chatId) + "/read",
          { messageId: m.id },
        );
        this.messageActions(m);
      },
      () => this.thread(),
    );
  }
  messageActions(m: Source) {
    this.reply = m;
    this.showMenu(
      "MESSAGE / " + short(m.sender, 25),
      "message",
      [
        ...(this.chat!.kind !== "channel"
          ? [
              {
                label: "Reply to this message",
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
          run: () => this.reactions(m),
        },
        {
          label: "Save message",
          detail: "Forward to your Saved Messages",
          run: () =>
            this.review(
              { kind: "save", chatId: m.chatId, messageId: m.id },
              m.revision,
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
                  this.read(
                    parent.sender + " / ORIGINAL",
                    parent.text,
                    "reply",
                    () => this.messageActions(m),
                    () => this.messageActions(m),
                  );
                },
              },
            ]
          : []),
        {
          label: "Search this conversation",
          detail: "Find older messages on glasses",
          run: () => this.startInput("messages"),
        },
        { label: "Back to conversation", run: () => this.thread() },
      ],
      () => this.thread(),
    );
  }
  reactions(m: Source) {
    this.showMenu(
      "CHOOSE REACTION",
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
          ),
      })),
      () => this.messageActions(m),
    );
  }
  compose(reply?: Source) {
    if (this.chat!.kind === "channel")
      throw new Error(
        "Channel posting is unavailable. Open the linked discussion in Telegram.",
      );
    if (this.reply?.id !== reply?.id) this.draft = "";
    this.reply = reply;
    this.inputPurpose = "compose";
    this.composeMenu();
  }
  composeMenu() {
    this.showMenu(
      (this.reply ? "REPLY / " : "WRITE / ") + short(this.chat!.title, 28),
      "compose",
      [
        {
          label: "Dictate message",
          detail: this.voiceEnabled
            ? "Hold ring/touchpad to speak"
            : "Speech service not configured",
          run: () => {
            if (!this.voiceEnabled)
              throw new Error(
                "Voice is not configured. Use the glasses keyboard.",
              );
            this.notice(
              "DICTATE",
              "Hold to record. Release to transcribe.\nYour transcript is reviewed before sending.",
              () => this.composeMenu(),
            );
          },
        },
        {
          label: "Glasses keyboard",
          detail: "Ring-controlled letters & punctuation",
          run: () => {
            this.inputText = this.draft;
            this.keyboard();
          },
        },
        {
          label: "Quick replies",
          detail: "Choose a phrase, then review",
          run: () => this.quickReplies(),
        },
        {
          label: "Review & send",
          detail: this.draft ? short(this.draft, 40) : "Draft is empty",
          run: () => {
            if (!this.draft.trim())
              throw new Error("Write or dictate a message first.");
            this.review(
              {
                kind: this.reply ? "reply" : "send",
                chatId: this.chat!.id,
                messageId: this.reply?.id ?? 0,
                text: this.draft,
              },
              this.reply?.revision ?? "",
            );
          },
        },
        {
          label: "Read draft",
          detail: this.draft.length + " characters",
          run: () =>
            this.read(
              "YOUR DRAFT",
              this.draft || "Draft is empty.",
              "compose",
              () => this.composeMenu(),
              () => this.composeMenu(),
            ),
        },
        {
          label: "Discard draft",
          detail: "Return to conversation",
          run: () => {
            this.draft = "";
            return this.thread();
          },
        },
      ],
      () => this.thread(),
    );
  }
  quickReplies() {
    this.showMenu(
      "QUICK REPLIES",
      "reply",
      [
        "On my way.",
        "Yes, I can bring it.",
        "Got it, thanks!",
        "I will be there in 10 minutes.",
        "Can we meet a little later?",
      ].map((text) => ({
        label: text,
        detail: "Choose to add to draft",
        run: () => {
          this.draft = text;
          this.composeMenu();
        },
      })),
      () => this.composeMenu(),
    );
  }
  startInput(purpose: "chats" | "messages") {
    this.inputPurpose = purpose;
    this.inputText = "";
    this.keyboard();
  }
  keyboard() {
    this.showMenu(
      (this.inputPurpose === "compose" ? "TYPE: " : "FIND: ") +
        short(this.inputText || "_", 29),
      "keyboard",
      [
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
              "TYPED TEXT",
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
            this.inputText = this.inputText.slice(0, -1);
            this.keyboard();
          },
        },
        {
          label: this.inputPurpose === "compose" ? "Done typing" : "Search",
          detail: this.inputText.length + " characters",
          run: () => this.finishInput(),
        },
      ],
      () =>
        this.inputPurpose === "compose"
          ? (() => {
              this.draft = this.inputText;
              this.composeMenu();
            })()
          : this.inputPurpose === "chats"
            ? this.chatList()
            : this.thread(),
    );
  }
  letters(group: string) {
    this.showMenu(
      "LETTER / " + short(this.inputText || "_", 28),
      "keyboard",
      group.split("").map((letter) => ({
        label: letter,
        detail: "Add to text",
        run: () => this.append(this.uppercase ? letter : letter.toLowerCase()),
      })),
      () => this.keyboard(),
    );
  }
  append(s: string) {
    if (this.inputText.length >= (this.inputPurpose === "compose" ? 4096 : 120))
      throw new Error("Telegram messages are limited to 4096 characters.");
    this.inputText += s;
    this.keyboard();
  }
  async finishInput() {
    if (this.inputPurpose === "compose") {
      this.draft = this.inputText;
      this.composeMenu();
    } else if (this.inputPurpose === "chats") this.chatList(this.inputText);
    else await this.openChat(this.chat!, this.inputText);
  }
  voiceText(text: string) {
    if (this.inputPurpose === "compose") {
      this.draft = text;
      this.composeMenu();
    } else {
      this.inputText = text;
      this.notice("TRANSCRIPT", text, () => this.finishInput());
    }
  }
  review(action: PersonalAction, revision: string) {
    this.pending = action;
    this.pendingRevision = revision;
    this.operationId = crypto.randomUUID();
    const destination =
      action.kind === "save" ? "Saved Messages" : this.chat!.title;
    this.read(
      "REVIEW / " + destination,
      (this.synthetic ? "SYNTHETIC DEMO\n" : "") +
        "To: " +
        destination +
        "\n" +
        (action.kind === "reply"
          ? "Reply to #" + action.messageId + "\n"
          : action.kind === "send"
            ? "New message\n"
            : action.kind === "react"
              ? "Reaction: " + action.reaction + "\n"
              : "Forward source #" + action.messageId + "\n") +
        (action.text ?? this.reply?.text ?? ""),
      "send",
      () => this.confirmMenu(),
      () => this.cancelReview(),
    );
  }
  cancelReview() {
    if (this.pending?.kind === "reply" || this.pending?.kind === "send")
      this.composeMenu();
    else if (this.reply) this.messageActions(this.reply);
    else return this.thread();
  }
  confirmMenu() {
    this.showMenu(
      "CONFIRM / " + short(this.chat!.title, 25),
      "send",
      [
        {
          label: "Send confirmed action",
          detail: "Only this tap sends to Telegram",
          run: () => this.send(),
        },
        {
          label: "Cancel",
          detail: "Keep draft; send nothing",
          run: () => this.cancelReview(),
        },
      ],
      () => this.cancelReview(),
    );
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
    } catch {
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
    this.draft = "";
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
      () => this.openChat(this.chat!),
    );
  }
  async catchup() {
    const d = await this.api("/brief");
    this.cards = d.cards;
    this.showMenu(
      "CATCH-UP / " + this.cards.length,
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
                () => this.openChat(chat, "", e.messageId),
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
      "CATCH-UP CHATS / " + this.watched.length + "/10",
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
    );
  }
  connection() {
    this.showMenu(
      "CONNECTION & CONTROLS",
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
              "Swipe: move through lists\nTap: open or continue\nDouble tap: go back\nHold: dictate in composer/search\nHome + double tap: exit",
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
  async input(event: Input) {
    if (this.busy || !this.active) return;
    this.busy = true;
    try {
      if (this.mode === "menu") {
        const m = this.menu!;
        if (event === "back") await m.back();
        else if (event === "tap") await m.rows[m.index]?.run();
        else {
          m.index =
            (m.index + (event === "down" ? 1 : -1) + m.rows.length) %
            m.rows.length;
          this.drawMenu();
        }
      } else if (this.mode === "thread") {
        if (event === "back") this.chatList();
        else if (event === "tap") {
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
        const max = Math.max(0, Math.ceil(wrap(this.reading).length / 6) - 1);
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
