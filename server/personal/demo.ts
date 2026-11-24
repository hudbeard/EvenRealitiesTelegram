import type {
  PersonalProvider,
  Chat,
  Message,
  PersonalAction,
  History,
} from "./types.js";
export class DemoPersonal implements PersonalProvider {
  readonly synthetic = true;
  messages: Message[];
  chats: Chat[] = [
    { id: "demo:maya", title: "Maya", kind: "dm", unread: 1, readMaxId: 10 },
    {
      id: "demo:crew",
      title: "Build night",
      kind: "group",
      unread: 2,
      readMaxId: 20,
    },
    {
      id: "demo:design",
      title: "Design team",
      kind: "group",
      unread: 0,
      readMaxId: 31,
    },
  ];
  writes: PersonalAction[] = [];
  constructor(now = Date.now()) {
    this.messages = [
      {
        id: 10,
        chatId: "demo:maya",
        sender: "You",
        outgoing: true,
        text: "I will bring the glasses to the station at 6.",
        date: now - 30 * 60000,
      },
      {
        id: 11,
        chatId: "demo:maya",
        sender: "Maya",
        outgoing: false,
        text: "Can you bring the prototype too?",
        date: now - 10 * 60000,
        replyTo: 10,
      },
      {
        id: 20,
        chatId: "demo:crew",
        sender: "Leo",
        outgoing: false,
        text: "Meet at the station at 6.",
        date: now - 25 * 60000,
      },
      {
        id: 21,
        chatId: "demo:crew",
        sender: "Leo",
        outgoing: false,
        text: "Update: meet at River Cafe at 6:30 instead of the station.",
        date: now - 5 * 60000,
        replyTo: 20,
      },
      {
        id: 22,
        chatId: "demo:crew",
        sender: "Nia",
        outgoing: false,
        text: "I have a spare charger.",
        date: now - 3 * 60000,
      },
      {
        id: 31,
        chatId: "demo:design",
        sender: "You",
        outgoing: true,
        text: "I'll send the working build before 6.",
        date: now - 20 * 60000,
      },
    ];
  }
  async dialogs() {
    const previews = new Map<string, string>();
    for (const message of this.messages)
      previews.set(message.chatId, message.text.slice(0, 160));
    return this.chats.map((chat) => ({
      ...chat,
      preview: previews.get(chat.id),
    }));
  }
  async saved() {
    let chat = this.chats.find((c) => c.id === "demo:saved");
    if (!chat) {
      chat = {
        id: "demo:saved",
        title: "Saved Messages",
        kind: "dm",
        unread: 0,
        readMaxId: 0,
      };
      this.chats.push(chat);
    }
    return { ...chat };
  }
  async history(chat: Chat, search = "", before?: number): Promise<History> {
    return {
      messages: this.messages.filter(
        (m) =>
          m.chatId === chat.id &&
          m.text.toLowerCase().includes(search.toLowerCase()) &&
          (!before || m.id < before),
      ),
      sponsored: [],
    };
  }
  async write(action: PersonalAction) {
    this.writes.push({ ...action });
    if (action.kind === "reply" || action.kind === "send") {
      const id = 100 + this.writes.length;
      this.messages.push({
        id,
        chatId: action.chatId,
        sender: "You",
        outgoing: true,
        text: action.text!,
        date: Date.now(),
        replyTo: action.kind === "reply" ? action.messageId : undefined,
      });
      return { messageId: id };
    }
    if (action.kind === "save") {
      const source = this.messages.find(
        (m) => m.chatId === action.chatId && m.id === action.messageId,
      );
      if (!source) throw new Error("Source not found");
      const saved = await this.saved(),
        id = 100 + this.writes.length;
      this.messages.push({
        ...source,
        id,
        chatId: saved.id,
        sender: "You",
        outgoing: true,
        date: Date.now(),
      });
      return { messageId: id };
    }
    return {};
  }
  async read(chatId: string, messageId: number) {
    const c = this.chats.find((c) => c.id === chatId);
    if (c) {
      c.readMaxId = Math.max(c.readMaxId, messageId);
      c.unread = this.messages.filter(
        (m) => m.chatId === chatId && !m.outgoing && m.id > c.readMaxId,
      ).length;
    }
  }
  async sponsoredView() {}
  async sponsoredClick() {}
  async close() {}
}
