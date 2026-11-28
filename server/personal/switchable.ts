import { Problem } from "../store.js";
import type { PersonalAction, PersonalProvider, Chat } from "./types.js";

/** Provider used before anyone has signed in to Telegram on this server. */
export class SignedOutProvider implements PersonalProvider {
  readonly synthetic = false;
  private fail(): never {
    throw new Problem(503, "Sign in to Telegram at /login on your server first.");
  }
  async dialogs(): Promise<Chat[]> {
    return this.fail();
  }
  async history() {
    return this.fail();
  }
  async saved(): Promise<Chat> {
    return this.fail();
  }
  async write(_action: PersonalAction) {
    return this.fail();
  }
  async read() {
    return this.fail();
  }
  async sponsoredView() {
    return this.fail();
  }
  async sponsoredClick() {
    return this.fail();
  }
  async close() {}
}

/**
 * Delegates to the current provider and lets a finished login swap in a new
 * one while the server keeps running (hot pick-up, no restart).
 */
export class SwitchableProvider implements PersonalProvider {
  constructor(private current: PersonalProvider) {}
  get synthetic() {
    return this.current.synthetic;
  }
  get signedIn() {
    return !(this.current instanceof SignedOutProvider);
  }
  /** Install a new provider and close the previous one. */
  async swap(next: PersonalProvider) {
    const previous = this.current;
    this.current = next;
    if (previous !== next) await previous.close().catch(() => {});
  }
  dialogs() {
    return this.current.dialogs();
  }
  history(...args: Parameters<PersonalProvider["history"]>) {
    return this.current.history(...args);
  }
  saved() {
    return this.current.saved();
  }
  write(action: PersonalAction) {
    return this.current.write(action);
  }
  read(chatId: string, messageId: number) {
    return this.current.read(chatId, messageId);
  }
  sponsoredView(chatId: string, id: string) {
    return this.current.sponsoredView(chatId, id);
  }
  sponsoredClick(chatId: string, id: string) {
    return this.current.sponsoredClick(chatId, id);
  }
  close() {
    return this.current.close();
  }
}
