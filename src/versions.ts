// Minecraft のバージョンごとの違い（ブロック名の一覧、名前の変更、高さの範囲）
import { BLOCK_DATA } from "./blocks.data.ts";

export const VERSION_RE = /^\d+(\.\d+){1,2}$/;

export function compareVersions(a: string, b: string): number {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const cumulative: Set<string>[] = [];
{
  let cur = new Set<string>();
  for (const d of BLOCK_DATA) {
    cur = new Set(cur);
    for (const n of d.remove) cur.delete(n);
    for (const n of d.add) cur.add(n);
    cumulative.push(cur);
  }
}

export const knownRange = () => ({ min: BLOCK_DATA[0]!.version, max: BLOCK_DATA.at(-1)!.version });

/**
 * その版で使えるブロック名。データにある版ちょうどなら正確な一覧。
 * 間の版（例: 1.21.2）は前後の版の和集合（存在しうる名前だけを通す）。範囲外は null（検査しない）
 */
export function blocksFor(version: string): Set<string> | null {
  if (!VERSION_RE.test(version)) throw new Error(`バージョン "${version}" の形式が不正です（例: 1.21.4, 26.1）`);
  const i = BLOCK_DATA.findIndex((d) => compareVersions(d.version, version) >= 0);
  if (i === -1 || compareVersions(version, BLOCK_DATA[0]!.version) < 0) return null;
  if (compareVersions(BLOCK_DATA[i]!.version, version) === 0) return cumulative[i]!;
  return new Set([...cumulative[i - 1]!, ...cumulative[i]!]);
}

/** 名前が変わったブロック。since 以降は new、それより前は old */
export const RENAMES: { old: string; new: string; since: string }[] = [
  { old: "grass_path", new: "dirt_path", since: "1.17" },
  { old: "grass", new: "short_grass", since: "1.20.3" },
  { old: "chain", new: "iron_chain", since: "1.21.9" },
];

/** version で通る名前に直す。直したときだけ新しい名前を返す */
export function renameFor(name: string, version: string): string | null {
  for (const r of RENAMES) {
    const newer = compareVersions(version, r.since) >= 0;
    if (newer && name === r.old) return r.new;
    if (!newer && name === r.new) return r.old;
  }
  return null;
}

/** 建築できる高さ。1.18 で -64〜319 に広がった */
export const yRange = (version: string): [number, number] =>
  compareVersions(version, "1.18") >= 0 ? [-64, 319] : [0, 255];
