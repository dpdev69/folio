import type { LaidLine } from "./paginate";

/** Map quotes onto line-local ranges. Quotes may cross a line break. */
export function highlightMap(lines: LaidLine[], quotes: string[]): Map<number, [number, number][]> {
  const map = new Map<number, [number, number][]>();
  const groups = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const bucket = groups.get(line.blockId) ?? [];
    bucket.push(index);
    groups.set(line.blockId, bucket);
  });
  for (const indexes of groups.values()) {
    let plain = "";
    const starts: number[] = [];
    for (const index of indexes) {
      if (plain.length) plain += " ";
      starts.push(plain.length);
      plain += lines[index].text;
    }
    const hay = plain.toLowerCase();
    for (const quote of quotes) {
      const needle = quote.trim().toLowerCase();
      if (needle.length < 2) continue;
      const at = hay.indexOf(needle);
      if (at < 0) continue;
      const end = at + needle.length;
      indexes.forEach((lineIndex, key) => {
        const start = starts[key];
        const lineEnd = start + lines[lineIndex].text.length;
        const from = Math.max(at, start) - start;
        const to = Math.min(end, lineEnd) - start;
        if (to <= from) return;
        const list = map.get(lineIndex) ?? [];
        list.push([from, to]);
        map.set(lineIndex, list);
      });
    }
  }
  return map;
}
