/**
 * Per-request timeouts. Health and pairing are quick probes of a local
 * server; Telegram-backed reads and writes get room for a slow connection.
 */
export function requestTimeout(path: string, method: "GET" | "POST") {
  if (path === "/health" || path.startsWith("/pair")) return 3_000;
  if (path === "/glasses/action" || path.startsWith("/login")) return 20_000;
  if (method === "GET") return 15_000; // dialogs, history, saved
  return 10_000;
}
/** Wearer-facing copy for a request that never got an answer. */
export function offlineMessage(method: "GET" | "POST") {
  return method === "GET"
    ? "Can't reach your server. Nothing was sent."
    : "Can't reach your server. Check Telegram before trying again.";
}
