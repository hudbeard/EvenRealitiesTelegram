import { TelegramClient, password as pwd } from "teleproto";
import { StringSession } from "teleproto/sessions";
import QRCode from "qrcode";
import { randomBytes } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

interface LoginSession {
  id: string;
  client: TelegramClient;
  createdAt: number;
  qrToken?: Buffer;
  qrExpires?: number;
  passwordCallback?: (password: string) => void;
  passwordError?: Error;
  user?: any;
  phoneNumber?: string;
  phoneCodeHash?: string;
}

const sessions = new Map<string, LoginSession>();

function cleanupOldSessions() {
  const cutoff = Date.now() - 10 * 60 * 1000; // 10 minutes
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < cutoff) {
      session.client.disconnect().catch(() => {});
      sessions.delete(id);
    }
  }
}

export async function startQRLogin(
  apiId: number,
  apiHash: string,
  demo: boolean,
): Promise<{ sessionId: string; qr: string; expiresIn: number; demo: boolean }> {
  cleanupOldSessions();

  const sessionId = randomBytes(16).toString("hex");
  
  if (demo) {
    // Demo mode: fake QR that auto-completes
    const fakeToken = `demo-${sessionId}`;
    const qr = await QRCode.toDataURL(`tg://login?token=${fakeToken}`, {
      width: 280,
      margin: 2,
    });
    
    sessions.set(sessionId, {
      id: sessionId,
      client: null as any,
      createdAt: Date.now(),
      qrToken: Buffer.from(fakeToken),
      qrExpires: Date.now() + 300000,
    });
    
    return { sessionId, qr, expiresIn: 300, demo: true };
  }

  const client = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    { connectionRetries: 2 },
  );

  client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);

  const session: LoginSession = {
    id: sessionId,
    client,
    createdAt: Date.now(),
  };

  sessions.set(sessionId, session);

  // Start QR login flow
  const loginPromise = client.signInUserWithQrCode(
    { apiId, apiHash },
    {
      qrCode: async (code) => {
        session.qrToken = code.token;
        session.qrExpires = code.expires * 1000;
      },
      password: async (hint) => {
        // Wait for password from HTTP endpoint
        return new Promise((resolve, reject) => {
          session.passwordCallback = (password: string) => {
            resolve(password);
            session.passwordCallback = undefined;
          };
          // Timeout after 5 minutes
          setTimeout(() => {
            if (session.passwordCallback) {
              reject(new Error("Password timeout"));
              session.passwordCallback = undefined;
            }
          }, 300000);
        });
      },
      onError: (err: Error) => {
        session.passwordError = err;
        // Don't stop on error, let caller handle it
      },
    },
  );

  // Store promise to retrieve user later
  loginPromise
    .then((user) => {
      session.user = user;
    })
    .catch((err) => {
      session.passwordError = err;
    });

  // Wait for QR code to be generated
  for (let i = 0; i < 50; i++) {
    if (session.qrToken) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (!session.qrToken) {
    client.disconnect();
    sessions.delete(sessionId);
    throw new Error("Failed to generate QR code");
  }

  const qr = await QRCode.toDataURL(
    `tg://login?token=${session.qrToken.toString("base64url")}`,
    { width: 280, margin: 2 },
  );

  const expiresIn = Math.max(
    0,
    Math.floor((session.qrExpires! - Date.now()) / 1000),
  );

  return { sessionId, qr, expiresIn, demo: false };
}

export async function checkQRLogin(
  sessionId: string,
  demo: boolean,
): Promise<
  | { status: "success"; user: any }
  | { status: "password_required" }
  | { status: "pending" }
  | { status: "error"; error: string }
> {
  const session = sessions.get(sessionId);
  if (!session) {
    return { status: "error", error: "Session expired" };
  }

  if (demo) {
    // Demo mode: auto-succeed after 3 seconds
    if (Date.now() - session.createdAt > 3000) {
      sessions.delete(sessionId);
      return {
        status: "success",
        user: { firstName: "Demo", username: "demo_user" },
      };
    }
    return { status: "pending" };
  }

  if (session.passwordCallback) {
    return { status: "password_required" };
  }

  if (session.user) {
    return { status: "success", user: session.user };
  }

  if (session.passwordError) {
    const error = session.passwordError.message;
    return { status: "error", error };
  }

  return { status: "pending" };
}

export async function submitQRPassword(
  sessionId: string,
  password: string,
  sessionFile: string,
  demo: boolean,
): Promise<{ status: "success"; user: any } | { status: "error"; error: string }> {
  if (demo) {
    await saveSessionToFile("demo-session-" + Date.now(), sessionFile);
    return {
      status: "success",
      user: { firstName: "Demo", username: "demo_user" },
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return { status: "error", error: "Session expired" };
  }

  if (!session.passwordCallback) {
    return { status: "error", error: "Password not requested" };
  }

  // Send password to waiting callback
  session.passwordCallback(password);

  // Wait for login to complete
  for (let i = 0; i < 100; i++) {
    if (session.user || session.passwordError) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (session.user) {
    // Save session
    const sessionString = session.client.session.save() as unknown as string;
    await saveSessionToFile(sessionString, sessionFile);
    
    await session.client.disconnect();
    sessions.delete(sessionId);

    return { status: "success", user: session.user };
  }

  if (session.passwordError) {
    const error = session.passwordError.message;
    await session.client.disconnect();
    sessions.delete(sessionId);
    return { status: "error", error };
  }

  return { status: "error", error: "Login timeout" };
}

export async function simulateQRScan(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error("Session expired");
  }
  
  // In demo mode, just mark as ready
  if (session.qrToken?.toString().startsWith("demo-")) {
    session.user = { firstName: "Demo", username: "demo_user" };
  }
}

// Phone login
export async function startPhoneLogin(
  apiId: number,
  apiHash: string,
  phoneNumber: string,
  demo: boolean,
): Promise<{ sessionId: string }> {
  cleanupOldSessions();

  const sessionId = randomBytes(16).toString("hex");

  if (demo) {
    sessions.set(sessionId, {
      id: sessionId,
      client: null as any,
      createdAt: Date.now(),
      phoneNumber,
      phoneCodeHash: "demo-hash",
    });
    return { sessionId };
  }

  const client = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    { connectionRetries: 2 },
  );

  client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);

  const session: LoginSession = {
    id: sessionId,
    client,
    createdAt: Date.now(),
    phoneNumber,
  };

  sessions.set(sessionId, session);

  // Start phone login
  const loginPromise = client.signInUser(
    { apiId, apiHash },
    {
      phoneNumber: async () => phoneNumber,
      phoneCode: async () => {
        // Wait for code from HTTP endpoint
        return new Promise((resolve) => {
          session.passwordCallback = (code: string) => {
            resolve(code);
            session.passwordCallback = undefined;
          };
        });
      },
      password: async (hint) => {
        // Wait for password from HTTP endpoint
        return new Promise((resolve) => {
          session.passwordCallback = (password: string) => {
            resolve(password);
            session.passwordCallback = undefined;
          };
        });
      },
      onError: (err: Error) => {
        session.passwordError = err;
      },
    },
  );

  loginPromise
    .then((user) => {
      session.user = user;
    })
    .catch((err) => {
      session.passwordError = err;
    });

  // Wait a bit for the code to be sent
  await new Promise((r) => setTimeout(r, 1000));

  return { sessionId };
}

export async function verifyPhoneCode(
  sessionId: string,
  code: string,
  demo: boolean,
): Promise<
  | { status: "success"; user: any }
  | { status: "password_required" }
  | { status: "error"; error: string }
> {
  if (demo) {
    return {
      status: "success",
      user: { firstName: "Demo", username: "demo_user" },
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return { status: "error", error: "Session expired" };
  }

  if (session.passwordCallback) {
    session.passwordCallback(code);
  }

  // Wait for login to complete or password request
  for (let i = 0; i < 100; i++) {
    if (session.user || session.passwordError || session.passwordCallback) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (session.user) {
    return { status: "success", user: session.user };
  }

  if (session.passwordCallback) {
    return { status: "password_required" };
  }

  if (session.passwordError) {
    return { status: "error", error: session.passwordError.message };
  }

  return { status: "error", error: "Verification timeout" };
}

export async function verifyPhonePassword(
  sessionId: string,
  password: string,
  sessionFile: string,
  demo: boolean,
): Promise<{ status: "success"; user: any } | { status: "error"; error: string }> {
  if (demo) {
    await saveSessionToFile("demo-session-" + Date.now(), sessionFile);
    return {
      status: "success",
      user: { firstName: "Demo", username: "demo_user" },
    };
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return { status: "error", error: "Session expired" };
  }

  if (session.passwordCallback) {
    session.passwordCallback(password);
  }

  // Wait for login to complete
  for (let i = 0; i < 100; i++) {
    if (session.user || session.passwordError) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  if (session.user) {
    const sessionString = session.client.session.save() as unknown as string;
    await saveSessionToFile(sessionString, sessionFile);
    
    await session.client.disconnect();
    sessions.delete(sessionId);

    return { status: "success", user: session.user };
  }

  if (session.passwordError) {
    const error = session.passwordError.message;
    await session.client.disconnect();
    sessions.delete(sessionId);
    return { status: "error", error };
  }

  return { status: "error", error: "Login timeout" };
}

async function saveSessionToFile(session: string, filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, session, { mode: 0o600 });
}
