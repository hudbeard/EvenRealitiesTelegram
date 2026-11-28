import { Store } from "../../server/store.js";
import { DemoPersonal } from "../../server/personal/demo.js";
import { PersonalService } from "../../server/personal/service.js";
import { GlassesApp, type Request } from "../../src/glasses/controller.js";

export const DEMO_NOW = 1_800_000_000_000;

/**
 * A GlassesApp wired to the real demo provider and PersonalService, with the
 * same checks the HTTP routes make (read needs a visible message; actions
 * need confirmed: true). `tick()` advances the app's clock (the 1 s guard and
 * relative times read it).
 */
export function demoHarness(
  options: { voice?: boolean; ideas?: (text: string) => Promise<string[]> } = {},
) {
  const db = new Store(":memory:"),
    p = new DemoPersonal(DEMO_NOW),
    s = new PersonalService(db, p);
  const calls: { path: string; body: any }[] = [];
  let failReads = false;
  const api: Request = async (path, body?: any) => {
    calls.push({ path, body });
    if (path === "/health")
      return {
        synthetic: true,
        voiceEnabled: !!options.voice,
        replyIdeasEnabled: !!options.ideas,
      };
    if (path === "/glasses/dialogs")
      return { chats: await p.dialogs(), watched: [] };
    if (path === "/glasses/saved") return p.saved();
    if (path.startsWith("/glasses/chats/")) {
      const id = decodeURIComponent(path.split("/")[3].split("?")[0]);
      if (path.endsWith("/read")) {
        if (failReads) throw Object.assign(new Error("offline"), { status: 0 });
        const h = await s.accountHistory(id, "", body.messageId + 1);
        if (!h.messages.some((m) => m.id === body.messageId))
          throw Object.assign(new Error("Message unavailable."), { status: 400 });
        await p.read(id, body.messageId);
        return { ok: true };
      }
      if (path.endsWith("/reply-ideas")) {
        const h = await s.accountHistory(id, "", body.messageId + 1);
        const m = h.messages.find((x) => x.id === body.messageId)!;
        return { replies: options.ideas ? await options.ideas(m.text) : [] };
      }
      const q = new URL("http://x" + path).searchParams;
      return s.accountHistory(
        id,
        q.get("search") ?? "",
        q.get("before") ? Number(q.get("before")) : undefined,
      );
    }
    if (path === "/glasses/action") {
      if (body?.confirmed !== true)
        throw Object.assign(new Error("Review and confirm first."), { status: 400 });
      return s.act(body.operationId, body.action, body.revision, true);
    }
    throw Error("unexpected " + path);
  };
  const app = new GlassesApp(api, () => {});
  let clock = DEMO_NOW;
  app.now = () => clock;
  return {
    app,
    p,
    calls,
    reads: () =>
      calls
        .filter((c) => c.path.endsWith("/read"))
        .map((c) => decodeURIComponent(c.path.split("/")[3]) + "#" + c.body.messageId),
    tick: (ms: number) => {
      clock += ms;
    },
    failReads: (value: boolean) => {
      failReads = value;
    },
    close: () => db.close(),
  };
}

/** Swipe the inbox focus onto the row whose label contains `title`. */
export async function focusRow(app: GlassesApp, title: string) {
  for (let i = 0; i < 20; i++) {
    const row = app.menu!.rows[app.menu!.index];
    if (row.label.includes(title)) return;
    await app.input("down");
  }
  throw new Error("row not found: " + title);
}
