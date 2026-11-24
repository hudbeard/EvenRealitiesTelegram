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
    return this.chats.map((c) => ({ ...c }));
  }
  async history(chat: Chat, search = ""): Promise<History> {
    return {
      messages: this.messages.filter(
        (m) =>
          m.chatId === chat.id &&
          m.text.toLowerCase().includes(search.toLowerCase()),
      ),
      sponsored: [],
    };
  }
  async write(action: PersonalAction) {
    this.writes.push({ ...action });
    if (action.kind === "reply") {
      const id = 100 + this.writes.length;
      this.messages.push({
        id,
        chatId: action.chatId,
        sender: "You",
        outgoing: true,
        text: action.text!,
        date: Date.now(),
        replyTo: action.messageId,
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
