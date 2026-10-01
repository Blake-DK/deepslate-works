// The server list's message (MOTD) with Minecraft's § colour and style codes, for the preview in Admin → Branding.

export const MC_COLOURS: Record<string, string> = {
  "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA", "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
  "8": "#555555", "9": "#5555FF", a: "#55FF55", b: "#55FFFF", c: "#FF5555", d: "#FF55FF", e: "#FFFF55", f: "#FFFFFF",
};

export type Run = { text: string; colour: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean };

/** Pure: one line into runs of the same look. A colour code resets the styles, as in the game; §r resets all. */
export function motdRuns(line: string, base = MC_COLOURS["7"]!): Run[] {
  const runs: Run[] = [];
  let cur: Omit<Run, "text"> = { colour: base, bold: false, italic: false, underline: false, strike: false };
  let text = "";
  const flush = () => {
    if (text) runs.push({ ...cur, text });
    text = "";
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    const code = line[i + 1]?.toLowerCase();
    if (ch === "§" && code !== undefined) {
      flush();
      if (MC_COLOURS[code]) cur = { colour: MC_COLOURS[code]!, bold: false, italic: false, underline: false, strike: false };
      else if (code === "l") cur = { ...cur, bold: true };
      else if (code === "o") cur = { ...cur, italic: true };
      else if (code === "n") cur = { ...cur, underline: true };
      else if (code === "m") cur = { ...cur, strike: true };
      else if (code === "r") cur = { colour: base, bold: false, italic: false, underline: false, strike: false };
      i++;
      continue;
    }
    text += ch;
  }
  flush();
  return runs;
}

/** Pure: what the line shows, without the codes (for its length: the list cuts off at about 45 characters). */
export const visible = (line: string) => line.replace(/§./g, "");

/** Pure: the two lines as server.properties writes `motd` (Java's Properties: § as §, the line break as \n). */
export function motdProperty(line1: string, line2: string): string {
  return [line1, line2].map((l) => l.replace(/[\r\n]/g, " ").trim()).filter(Boolean).join("\n").replace(/\\/g, "\\\\").replace(/§/g, "\\u00A7").replace(/\n/g, "\\n");
}
