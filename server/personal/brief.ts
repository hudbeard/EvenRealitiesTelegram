import type { Chat, Message, BriefCard, Evidence } from "./types.js";
// These rules point to messages; they do not invent decisions, deadlines, or tasks.
export function catchup(
  chats: Chat[],
  messages: Message[],
  since = 0,
): BriefCard[] {
  const cards: BriefCard[] = [];
  const ordered = [...messages].sort((a, b) => b.date - a.date);
  for (const m of ordered) {
    const chat = chats.find((c) => c.id === m.chatId);
    if (!chat || Math.max(m.date, m.editedAt ?? 0) < since || !m.text.trim())
      continue;
    const unread = m.id > chat.readMaxId;
    if (!m.outgoing && !unread && !(m.editedAt && m.editedAt > since)) continue;
    const source: Evidence = {
      chatId: m.chatId,
      chatTitle: chat.title,
      messageId: m.id,
      quote: m.text,
      sender: m.sender,
    };
    const previous = m.replyTo
      ? messages.find((p) => p.chatId === m.chatId && p.id === m.replyTo)
      : undefined;
    const evidence = [source];
    if (previous)
      evidence.push({
        chatId: previous.chatId,
        chatTitle: chat.title,
        messageId: previous.id,
        quote: previous.text,
        sender: previous.sender,
      });
    const explicitChange =
      /\b(instead|rescheduled|cancelled|canceled|moved to|changed to|make that)\b|\bupdate\s*:|\bactually[, :]/i.test(
        m.text,
      );
    if (
      !m.outgoing &&
      (explicitChange || (!!m.editedAt && m.editedAt > since))
    ) {
      cards.push({
        id: `change:${m.chatId}:${m.id}`,
        kind: "change",
        title: explicitChange
          ? "A possible plan change"
          : "A source message was edited",
        why: explicitChange
          ? "This message explicitly signals a change. Open its source before acting."
          : "Telegram reports an edit after the catch-up checkpoint. Open the current source.",
        priority: 100,
        evidence,
      });
    } else if (!m.outgoing && previous?.outgoing) {
      cards.push({
        id: `reply:${m.chatId}:${m.id}`,
        kind: "reply",
        title: "Someone replied to you",
        why: "Linked directly to one of your messages.",
        priority: 90,
        evidence,
      });
    } else if (
      !m.outgoing &&
      m.id > chat.readMaxId &&
      /\?\s*$/.test(m.text.trim())
    ) {
      cards.push({
        id: `question:${m.chatId}:${m.id}`,
        kind: "question",
        title:
          chat.kind === "dm"
            ? "A question in your DMs"
            : "An unread group question",
        why:
          chat.kind === "dm"
            ? "An unread direct message ends with a question."
            : "This may be for the group; it is not automatically assigned to you.",
        priority: chat.kind === "dm" ? 85 : 55,
        evidence,
      });
    } else if (
      m.outgoing &&
      /\bI(?:'ll| will| can)\s+(?:send|bring|check|share|finish|confirm|review)\b/i.test(
        m.text,
      )
    ) {
      cards.push({
        id: `commitment:${m.chatId}:${m.id}`,
        kind: "commitment",
        title: "Something you said you would do",
        why: "Quoted from your own message. Completion has not been inferred.",
        priority: 70,
        evidence,
      });
    }
  }
  return cards.sort((a, b) => b.priority - a.priority).slice(0, 20);
}
