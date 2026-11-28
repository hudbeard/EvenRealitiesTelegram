#!/usr/bin/env tsx
import "dotenv/config";
import { generateQRToken, checkQRLogin, saveSession } from "../server/personal/qr-login.js";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
  console.error("Error: Set TELEGRAM_API_ID and TELEGRAM_API_HASH in .env first.");
  process.exit(1);
}

console.log("Fieldline QR Login");
console.log("==================\n");
console.log("This will generate a QR code for Telegram login.");
console.log("Scan it with your Telegram app:");
console.log("  Settings → Devices → Link Desktop Device\n");

(async () => {
  try {
    console.log("Generating QR code...");
    const tokenData = await generateQRToken(apiId, apiHash);
    
    const tokenBase64 = tokenData.token.toString("base64url");
    const qrData = `tg://login?token=${tokenBase64}`;
    const expiresIn = Math.max(0, tokenData.expires - Math.floor(Date.now() / 1000));
    
    console.log("\nQR Code Data (use a QR generator to display):");
    console.log(qrData);
    console.log(`\nExpires in: ${expiresIn} seconds\n`);
    
    // Try to generate ASCII QR if qrcode-terminal is available
    try {
      const qrcode = await import("qrcode-terminal" as any);
      console.log("Scan this QR code with Telegram:\n");
      (qrcode as any).generate(qrData, { small: true });
    } catch {
      console.log("Install qrcode-terminal for a visual QR code:");
      console.log("  npm install --save-dev qrcode-terminal\n");
    }
    
    console.log("\nPolling for scan... (this may take a moment)");
    
    let attempts = 0;
    const maxAttempts = Math.floor(expiresIn / 2); // Poll every 2 seconds
    
    const poll = async (): Promise<boolean> => {
      if (attempts++ > maxAttempts) {
        console.error("\nQR code expired. Please try again.");
        return false;
      }
      
      const result = await checkQRLogin(apiId, apiHash, tokenData.token);
      
      if (result.success && result.session) {
        const sessionFile = process.env.TELEGRAM_SESSION_FILE ?? ".data/personal.session";
        await saveSession(result.session, sessionFile);
        console.log("\n✓ QR login successful!");
        console.log(`Session saved to: ${sessionFile}`);
        console.log("\nYou can now run:");
        console.log("  npm run personal:server");
        return true;
      } else if (result.error) {
        console.error(`\nError: ${result.error}`);
        return false;
      }
      
      // Still pending, wait and try again
      process.stdout.write(".");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return poll();
    };
    
    const success = await poll();
    process.exit(success ? 0 : 1);
  } catch (error: any) {
    console.error(`\nFailed to login: ${error.message}`);
    process.exit(1);
  }
})();
