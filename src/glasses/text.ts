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

export function fitLine(text: string, pixels: number) {
  const line = Array.from(text.replace(/[\r\n\t]+/g, " "))
    .slice(0, 120)
    .join("");
  return pxTruncate(line, pixels);
}
