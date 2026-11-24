export type Chat = {
  id: string;
  title: string;
  kind: "dm" | "group" | "channel";
  unread: number;
  readMaxId: number;
};
export type Message = {
  id: number;
  chatId: string;
  sender: string;
  text: string;
  outgoing: boolean;
  date: number;
  replyTo?: number;
  editedAt?: number;
  media?: string;
};
export type Sponsored = {
  id: string;
  title: string;
  text: string;
  url: string;
  buttonText?: string;
  disclosure?: string;
  minSeconds?: number;
};
export type History = { messages: Message[]; sponsored: Sponsored[] };
export type PersonalAction = {
  kind: "reply" | "react" | "save";
  chatId: string;
  messageId: number;
  text?: string;
  reaction?: string;
};
export interface PersonalProvider {
  readonly synthetic: boolean;
  dialogs(): Promise<Chat[]>;
  history(chat: Chat, search?: string): Promise<History>;
  write(action: PersonalAction): Promise<{ messageId?: number }>;
  read(chatId: string, messageId: number): Promise<void>;
  sponsoredView(chatId: string, id: string): Promise<void>;
  sponsoredClick(chatId: string, id: string): Promise<void>;
  close(): Promise<void>;
}
export type Evidence = {
  chatId: string;
  chatTitle: string;
  messageId: number;
  quote: string;
  sender: string;
};
export type BriefCard = {
  id: string;
  kind: "change" | "question" | "commitment" | "reply";
  title: string;
  why: string;
  priority: number;
  evidence: Evidence[];
};
