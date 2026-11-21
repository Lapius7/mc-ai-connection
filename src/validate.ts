// 実行前の検査: ブロック名・高さをバージョンに合わせて確かめ、名前の変更は自動で直す
import { blocksFor, compareVersions, knownRange, renameFor, yRange } from "./versions.ts";

export type Prepared = { cmds: string[]; notes: string[]; errors: string[] };

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

export function suggest(name: string, names: Set<string>): string | null {
  let best: string | null = null, bd = 4;
  for (const n of names) {
    const dist = distance(name, n);
    if (dist < bd) { bd = dist; best = n; }
  }
  return best;
}

/** "minecraft:oak_stairs[facing=north]{...}" → 名前の部分だけ（名前空間つき・タグ・他の名前空間は null） */
function blockName(tok: string): string | null {
  if (tok.startsWith("#")) return null;
  const base = tok.split(/[[{]/)[0]!;
  if (base.includes(":") && !base.startsWith("minecraft:")) return null;
  return base.replace(/^minecraft:/, "");
}

const reTok = (tok: string, to: string) => {
  const rest = tok.slice(tok.split(/[[{]/)[0]!.length);
  return (tok.split(/[[{]/)[0]!.startsWith("minecraft:") ? "minecraft:" : "") + to + rest;
};

const isInt = (s: string | undefined) => s !== undefined && /^-?\d+$/.test(s);

/** fill / setblock / clone のブロック名と高さを検査し、名前の変更を直す。version が無ければ何もしない */
export function prepare(cmds: string[], version?: string): Prepared {
  if (!version) return { cmds, notes: [], errors: [] };
  const names = blocksFor(version);
  const [yMin, yMax] = yRange(version);
  const notes: string[] = [];
  const errors = new Set<string>();
  const renamed = new Map<string, string>();
  if (!names) {
    const { min, max } = knownRange();
    notes.push(compareVersions(version, min) < 0
      ? `バージョン ${version} は ${min} より古いため、ブロック名は検査しません`
      : `バージョン ${version} は一覧（${max} まで）より新しいため、ブロック名は検査しません`);
  }
  const fixTok = (tok: string, where: string): string => {
    const n = blockName(tok);
    if (n === null) return tok;
    const to = renameFor(n, version);
    if (to) { renamed.set(n, to); return reTok(tok, to); }
    if (names && !names.has(n)) {
      const s = suggest(n, names);
      errors.add(`${where}: "${n}" はバージョン ${version} にないブロックです${s ? `（もしかして ${s}）` : ""}`);
    }
    return tok;
  };
  const cache = new Map<string, string>();
  const fixCached = (tok: string, where: string) => {
    const k = where + tok;
    let r = cache.get(k);
    if (r === undefined) { r = fixTok(tok, where); cache.set(k, r); }
    return r;
  };
  const checkY = (c: string, ys: (string | undefined)[]) => {
    for (const y of ys) if (isInt(y) && (Number(y) < yMin || Number(y) > yMax))
      errors.add(`${c.split(/\s+/)[0]}: 高さ ${y} はバージョン ${version} の範囲（${yMin}〜${yMax}）外です`);
  };
  const out = cmds.map((c) => {
    const t = c.trim().replace(/^\//, "").split(/\s+/);
    if (t[0] === "setblock" && t.length >= 5) {
      checkY(c, [t[2]]);
      const n = fixCached(t[4]!, "setblock");
      if (n === t[4]) return c;
      t[4] = n;
      return t.join(" ");
    }
    if (t[0] === "fill" && t.length >= 8) {
      checkY(c, [t[2], t[5]]);
      const n = fixCached(t[7]!, "fill");
      let changed = n !== t[7];
      t[7] = n;
      if (t[8] === "replace" && t[9]) {
        const f = fixCached(t[9], "fill replace");
        if (f !== t[9]) { t[9] = f; changed = true; }
      }
      return changed ? t.join(" ") : c;
    }
    if (t[0] === "clone") checkY(c, [t[2], t[5], t[8]]);
    return c;
  });
  for (const [a, b] of renamed) notes.push(`ブロック名 ${a} を、バージョン ${version} の ${b} に読み替えました`);
  return { cmds: out, notes, errors: [...errors].slice(0, 5) };
}
