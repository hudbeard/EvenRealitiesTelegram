import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomInt, createHash } from "node:crypto";
export type Status =
  | "pending"
  | "sending"
  | "sent"
  | "uncertain"
  | "failed"
  | "dismissed"
  | "expired";
export type Task = {
  id: string;
  chatId: string;
  chatName: string;
  messageId: number;
  threadId: number | null;
  sender: string;
  text: string;
  createdAt: number;
  expiresAt: number;
  status: Status;
  reply: string | null;
  receipt: number | null;
  operationId: string | null;
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class Problem extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class Store {
  db: DatabaseSync;
  constructor(
    path: string,
    public now: () => number = Date.now,
  ) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,chatId TEXT NOT NULL,chatName TEXT NOT NULL,messageId INTEGER NOT NULL,threadId INTEGER,sender TEXT NOT NULL,text TEXT NOT NULL,createdAt INTEGER NOT NULL,expiresAt INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reply TEXT,receipt INTEGER,operationId TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS pairing(id TEXT PRIMARY KEY,code TEXT UNIQUE,expiresAt INTEGER NOT NULL,tokenHash TEXT,token TEXT);
      CREATE TABLE IF NOT EXISTS sessions(tokenHash TEXT PRIMARY KEY,expiresAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    // A process crash during an external send is ambiguous. Never resend it.
    this.db
      .prepare("UPDATE tasks SET status='uncertain' WHERE status='sending'")
      .run();
    this.db.exec("DELETE FROM pairing;");
  }
  close() {
    this.db.close();
  }
  pair() {
    this.db.prepare("DELETE FROM pairing WHERE expiresAt < ?").run(this.now());
    this.db.prepare("DELETE FROM sessions WHERE expiresAt < ?").run(this.now());
    if (
      (
        this.db.prepare("SELECT COUNT(*) AS n FROM pairing").get() as {
          n: number;
        }
      ).n >= 30
    )
      throw new Problem(429, "Too many pairing requests. Wait five minutes.");
    const id = randomBytes(32).toString("hex"),
      code = String(randomInt(100000, 1000000));
    this.db
      .prepare("INSERT INTO pairing(id,code,expiresAt) VALUES(?,?,?)")
      .run(id, code, this.now() + 300000);
    return { id, code, expiresAt: this.now() + 300000 };
  }
  approve(code: string) {
    const pair = this.db
      .prepare(
        "SELECT id FROM pairing WHERE code=? AND expiresAt>? AND tokenHash IS NULL",
      )
      .get(code, this.now()) as { id: string } | undefined;
    if (!pair) return false;
    const token = randomBytes(32).toString("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?)")
        .run(hash(token), this.now() + 4 * 3600000);
      this.db
        .prepare("UPDATE pairing SET tokenHash=?,token=? WHERE id=?")
        .run(hash(token), token, pair.id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return true;
  }
  pairing(id: string) {
    const row = this.db
      .prepare("SELECT token,expiresAt FROM pairing WHERE id=?")
      .get(id) as { token: string | null; expiresAt: number } | undefined;
    if (!row || row.expiresAt < this.now())
      throw new Problem(410, "Pairing expired. Start again.");
    // Retained only until the short pairing expiry so a lost HTTP response can be retried.
    return { token: row.token };
  }
  authorize(token: string) {
    return (
      !!token &&
      !!this.db
        .prepare("SELECT 1 FROM sessions WHERE tokenHash=? AND expiresAt>?")
        .get(hash(token), this.now())
    );
  }
  revoke(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE tokenHash=?").run(hash(token));
    this.db.prepare("DELETE FROM pairing WHERE tokenHash=?").run(hash(token));
  }
  add(task: Omit<Task, "status" | "reply" | "receipt" | "operationId">) {
    if (this.db.prepare("SELECT 1 FROM tasks WHERE id=?").get(task.id)) return;
    const count = (
      this.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }
    ).n;
    if (count >= 1000)
      this.db
        .prepare(
          "DELETE FROM tasks WHERE createdAt < ? AND status NOT IN ('sending','uncertain')",
        )
        .run(this.now() - 24 * 3600000);
    if (
      (
        this.db.prepare("SELECT COUNT(*) AS n FROM tasks").get() as {
          n: number;
        }
      ).n >= 1000
    )
      throw new Problem(
        503,
        "Request storage full. Operator maintenance required.",
      );
    this.db
      .prepare(
        "INSERT OR IGNORE INTO tasks(id,chatId,chatName,messageId,threadId,sender,text,createdAt,expiresAt) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        task.id,
        task.chatId,
        task.chatName,
        task.messageId,
        task.threadId,
        task.sender,
        task.text,
        task.createdAt,
        task.expiresAt,
      );
  }
  get(id: string) {
    const task = this.db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as
      Task | undefined;
    if (!task) throw new Problem(404, "Request no longer exists.");
    return task;
  }
  list() {
    this.db
      .prepare(
        "DELETE FROM tasks WHERE createdAt < ? AND status NOT IN ('sending','uncertain')",
      )
      .run(this.now() - 24 * 3600000);
    this.db
      .prepare(
        "UPDATE tasks SET status='expired' WHERE status='pending' AND expiresAt<=?",
      )
      .run(this.now());
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE status IN ('pending','sending','uncertain') ORDER BY createdAt DESC LIMIT 50",
      )
      .all() as Task[];
  }
  history() {
    return this.db
      .prepare(
        "SELECT * FROM tasks WHERE status NOT IN ('pending','sending') ORDER BY createdAt DESC LIMIT 10",
      )
      .all() as Task[];
  }
  claim(id: string, operationId: string, reply: string) {
    const task = this.get(id);
    if (task.operationId === operationId) {
      if (task.reply !== reply)
        throw new Problem(
          409,
          "Confirmation does not match the reviewed reply.",
        );
      return { task, claimed: false };
    }
    if (task.status !== "pending")
      throw new Problem(409, "This request has already been handled.");
    if (task.expiresAt <= this.now())
      throw new Problem(
        409,
        "Request expired. Ask the coordinator to send it again.",
      );
    try {
      const changed = this.db
        .prepare(
          "UPDATE tasks SET status='sending',operationId=?,reply=? WHERE id=? AND status='pending'",
        )
        .run(operationId, reply, id);
      if (!changed.changes)
        throw new Problem(409, "Request changed. Refresh first.");
    } catch (e) {
      if (e instanceof Problem) throw e;
      throw new Problem(409, "Confirmation was already used.");
    }
    return { task: this.get(id), claimed: true };
  }
  outcome(id: string, status: Status, receipt: number | null = null) {
    this.db
      .prepare("UPDATE tasks SET status=?,receipt=? WHERE id=?")
      .run(status, receipt, id);
    return this.get(id);
  }
  dismiss(id: string) {
    const changed = this.db
      .prepare(
        "UPDATE tasks SET status='dismissed' WHERE id=? AND status='pending'",
      )
      .run(id);
    if (!changed.changes)
      throw new Problem(409, "Request has already changed.");
    return this.get(id);
  }
  offset() {
    return Number(
      (
        this.db
          .prepare("SELECT value FROM metadata WHERE key='offset'")
          .get() as { value: string } | undefined
      )?.value ?? 0,
    );
  }
  offsetTo(value: number) {
    this.db
      .prepare(
        "INSERT INTO metadata VALUES('offset',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(String(value));
  }
}
