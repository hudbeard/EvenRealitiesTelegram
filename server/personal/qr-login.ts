import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface QRLoginResult {
  success: boolean;
  session?: string;
  error?: string;
}

export interface QRTokenData {
  token: Buffer;
  expires: number;
}

/**
 * Generates a QR login token from Telegram.
 * Returns the token data that should be encoded into a QR code as: tg://login?token=base64url(token)
 */
export async function generateQRToken(
  apiId: number,
  apiHash: string,
): Promise<QRTokenData> {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 2,
    requestRetries: 1,
  });

  client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);

  try {
    await client.connect();

    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId,
        apiHash,
        exceptIds: [],
      }),
    );

    if (result instanceof Api.auth.LoginToken) {
      return {
        token: result.token,
        expires: result.expires,
      };
    } else if (result instanceof Api.auth.LoginTokenSuccess) {
      // Already logged in somehow, return the authorization
      throw new Error("Unexpected: already authorized during token export");
    } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
      throw new Error(
        "Login token requires DC migration. This is not yet supported. Use phone/code login instead.",
      );
    }

    throw new Error("Unknown response from auth.exportLoginToken");
  } finally {
    await client.disconnect();
  }
}

/**
 * Polls Telegram to check if the QR code was scanned.
 * Returns success and session string if login completed.
 */
export async function checkQRLogin(
  apiId: number,
  apiHash: string,
  token: Buffer,
  password?: string,
): Promise<QRLoginResult> {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 2,
    requestRetries: 1,
    floodSleepThreshold: 0,
  });

  client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);

  try {
    await client.connect();

    const result = await client.invoke(
      new Api.auth.ImportLoginToken({ token }),
    );

    if (result instanceof Api.auth.LoginTokenSuccess) {
      const authorization = result.authorization;

      if (authorization instanceof Api.auth.Authorization) {
        // Successfully logged in
        const sessionString = String(client.session.save());
        return { success: true, session: sessionString };
      } else if (authorization instanceof Api.auth.AuthorizationSignUpRequired) {
        return {
          success: false,
          error: "Sign up required. Please complete registration in Telegram first.",
        };
      }
    } else if (result instanceof Api.auth.LoginToken) {
      // Token still valid but not scanned yet
      return { success: false };
    } else if (result instanceof Api.auth.LoginTokenMigrateTo) {
      return {
        success: false,
        error: "DC migration required. Use phone/code login instead.",
      };
    }

    return { success: false };
  } catch (err: any) {
    if (err.errorMessage === "SESSION_PASSWORD_NEEDED") {
      if (!password) {
        return {
          success: false,
          error: "Two-factor authentication enabled. Use phone/code login instead.",
        };
      }
      // Handle 2FA
      try {
        await client.invoke(
          new Api.account.GetPassword(),
        );
        // This would need password verification, but for now we'll return an error
        return {
          success: false,
          error: "Two-factor authentication enabled. Use phone/code login instead.",
        };
      } catch {
        return {
          success: false,
          error: "Two-factor authentication failed.",
        };
      }
    }

    if (err.errorMessage === "AUTH_TOKEN_EXPIRED") {
      return { success: false, error: "QR code expired. Generate a new one." };
    }

    if (err.errorMessage === "AUTH_TOKEN_INVALID") {
      return { success: false, error: "Invalid token." };
    }

    return { success: false, error: err.message || "Unknown error" };
  } finally {
    await client.disconnect();
  }
}

/**
 * Convenience function to save a session to file
 */
export async function saveSession(
  sessionString: string,
  filePath: string,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, sessionString, { mode: 0o600 });
}
