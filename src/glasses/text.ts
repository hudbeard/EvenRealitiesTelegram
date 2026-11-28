import { getTextWidth, pxTruncate } from "@evenrealities/pretext";

const encoder = new TextEncoder();

// Leave room inside the text box for the review card's padding and border.
export function wrap(text: string, pixels = 520): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .flatMap((paragraph) => {
      const result: string[] = [];
      const fits = (value: string) =>
        getTextWidth(value) <= pixels && encoder.encode(value).length <= 144;
      let line = "";
      for (const token of paragraph.match(/\s+|\S+/gu) ?? []) {
        if (line && !fits(line + token)) {
          result.push(line);
          line = "";
        }
        if (fits(token)) {
          line += token;
          continue;
        }
        for (const char of token) {
          if (line && !fits(line + char)) {
            result.push(line);
            line = "";
          }
          line += char;
        }
      }
      result.push(line);
      return result;
    });
}

/** `prefix + title + suffix` within `pixels`, truncating only the title. */
export function fitWithSuffix(
  prefix: string,
  title: string,
  suffix: string,
  pixels: number,
) {
  const whole = prefix + title + suffix;
  if (getTextWidth(whole) <= pixels) return whole;
  const room = pixels - getTextWidth(prefix + suffix);
  return prefix + pxTruncate(title, Math.max(0, room)) + suffix;
}

/** Wrap and keep at most `max` lines; a cut last line ends with an ellipsis. */
export function clampLines(text: string, max: number, pixels = 520) {
  const lines = wrap(text, pixels);
  if (lines.length <= max) return lines.join("\n");
  const kept = lines.slice(0, max);
  kept[max - 1] = pxTruncate(kept[max - 1].trimEnd() + " …", pixels);
  return kept.join("\n");
}

/** Glanceable time: just now, 5m, 3h, yesterday, or a short date. */
export function relativeTime(at: number, now: number) {
  const diff = now - at;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m";
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (diff < 86_400_000 && at >= startOfToday.getTime())
    return Math.floor(diff / 3_600_000) + "h";
  const startOfYesterday = new Date(now);
  startOfYesterday.setHours(0, 0, 0, 0);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (at >= startOfYesterday.getTime()) return "yesterday";
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function fitLine(text: string, pixels: number) {
  const line = Array.from(text.replace(/[\r\n\t]+/g, " "))
    .slice(0, 120)
    .join("");
  return pxTruncate(line, pixels);
}
