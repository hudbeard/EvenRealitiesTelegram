import { test } from "node:test";
import assert from "node:assert/strict";
import { Api, type TelegramClient } from "teleproto";
import { AccountTelegram } from "../server/personal/mtproto.js";
test("account adapter uses resolved peer identity, preserves exact reply text, and uses real read/reaction/save methods", async () => {
  const peer = new Api.InputPeerSelf();
  const calls: { name: string; args: unknown[] }[] = [];
  const client = {
    async getDialogs() {
      return [
        {
          id: { toString: () => "123" },
          isCommunity: false,
          inputEntity: peer,
          title: "Maya",
          isUser: true,
          isGroup: false,
          unreadCount: 2,
          dialog: {},
        },
      ];
    },
    async sendMessage(...args: unknown[]) {
      calls.push({ name: "reply", args });
      return { id: 91 };
    },
    async forwardMessages(...args: unknown[]) {
      calls.push({ name: "save", args });
      return [{ id: 92 }];
    },
    async markAsRead(...args: unknown[]) {
      calls.push({ name: "read", args });
      return true;
    },
    async invoke(...args: unknown[]) {
      calls.push({ name: "invoke", args });
      return true;
    },
  } as unknown as TelegramClient;
  const account = new AccountTelegram(client);
  await account.dialogs();
  assert.equal(
    (
      await account.write({
        kind: "reply",
        chatId: "123",
        messageId: 8,
        text: "I will bring the prototype.",
      })
    ).messageId,
    91,
  );
  assert.equal(calls[0].args[0], peer);
  assert.deepEqual(calls[0].args[1], {
    message: "I will bring the prototype.",
    replyTo: 8,
    parseMode: false,
  });
  await account.write({ kind: "save", chatId: "123", messageId: 8 });
  assert.equal(calls[1].args[0], "me");
  assert.equal((calls[1].args[1] as { fromPeer: unknown }).fromPeer, peer);
  await account.read("123", 8);
  assert.deepEqual(calls[2].args, [peer, 8]);
  await account.write({
    kind: "react",
    chatId: "123",
    messageId: 8,
    reaction: "👍",
  });
  assert.ok(calls[3].args[0] instanceof Api.messages.SendReaction);
});
