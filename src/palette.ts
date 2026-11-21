// ブロックパレット: 複数のブロックを割合で混ぜて配置する（純粋関数）
import { fillCmds, hi, lo, volume, type Vec } from "./builders.ts";

export type PaletteItem = { block: string; weight: number };
export type Palette = PaletteItem[];
export type BlockInput = string | { block: string; weight?: number }[];

/** 1回の操作で割合どおりに混ぜられる最大ブロック数（1ブロックずつコマンドになりうるため） */
export const MAX_PALETTE_BLOCKS = Number(process.env.MC_MAX_PALETTE_BLOCKS ?? 30_000);

export function toPalette(input: BlockInput): Palette | null {
  if (typeof input === "string") return null;
  const items = input.map((i) => ({ block: i.block, weight: i.weight ?? 1 }));
  if (items.length === 0) throw new Error("パレットが空です");
  if (items.some((i) => !(i.weight > 0) || !Number.isFinite(i.weight))) throw new Error("weight は 0 より大きい数にしてください");
  return items;
}

export const describePalette = (p: Palette) => {
  const sum = p.reduce((n, i) => n + i.weight, 0);
  return p.map((i) => `${i.block} ${Math.round((i.weight / sum) * 100)}%`).join(" / ");
};

/** 同じ seed なら同じ並びになる乱数（ドライランと本番、やり直しで揃えるため） */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const picker = (p: Palette, rand: () => number) => {
  const sum = p.reduce((n, i) => n + i.weight, 0);
  return () => {
    let r = rand() * sum;
    for (const i of p) if ((r -= i.weight) < 0) return i.block;
    return p[p.length - 1]!.block;
  };
};

/**
 * mode なしの fill と setblock のブロック名を、パレットから1ブロックずつ選び直す。
 * Z 方向に同じブロックが続く所は、1つの fill にまとめる
 */
export const MARK = "__pal__";

export function paletteCmds(cmds: string[], palette: Palette, seed = 1, marker?: string): string[] {
  const pick = picker(palette, rng(seed));
  const out: string[] = [];
  let cells = 0;
  for (const c of cmds) {
    const t = c.trim().split(/\s+/);
    // marker があるときは、そのブロック名のコマンドだけ混ぜる（ほかはそのまま通す）
    if (marker && t[t.length - 1] !== marker) { out.push(c); continue; }
    let a: Vec, b: Vec;
    if (t[0] === "setblock" && t.length === 5) {
      a = b = [Number(t[1]), Number(t[2]), Number(t[3])];
    } else if (t[0] === "fill" && t.length === 8) {
      a = [Number(t[1]), Number(t[2]), Number(t[3])];
      b = [Number(t[4]), Number(t[5]), Number(t[6])];
    } else throw new Error(`パレットを使えないコマンドです: ${c}`);
    if ([...a, ...b].some((n) => !Number.isInteger(n))) throw new Error(`絶対座標だけ使えます: ${c}`);
    cells += volume(a, b);
    if (cells > MAX_PALETTE_BLOCKS)
      throw new Error(`パレットで混ぜられるのは ${MAX_PALETTE_BLOCKS} ブロックまでです（MC_MAX_PALETTE_BLOCKS で変更可）。範囲を小さくするか、単一のブロックにしてください`);
    const l = lo(a, b), h = hi(a, b);
    for (let x = l[0]; x <= h[0]; x++)
      for (let y = l[1]; y <= h[1]; y++) {
        const row = Array.from({ length: h[2] - l[2] + 1 }, pick);
        for (let i = 0; i < row.length; ) {
          let e = i;
          while (e + 1 < row.length && row[e + 1] === row[i]) e++;
          out.push(`fill ${x} ${y} ${l[2] + i} ${x} ${y} ${l[2] + e} ${row[i]}`);
          i = e + 1;
        }
      }
  }
  return out;
}

/** 直方体の表面（6面）を、重ならない板に分ける。幅1の方向でも重複しない */
export function shellBoxes(a: Vec, b: Vec): { lo: Vec; hi: Vec }[] {
  const l = lo(a, b), h = hi(a, b);
  const out: { lo: Vec; hi: Vec }[] = [{ lo: [l[0], l[1], l[2]], hi: [l[0], h[1], h[2]] }];
  if (h[0] > l[0]) out.push({ lo: [h[0], l[1], l[2]], hi: [h[0], h[1], h[2]] });
  const x1 = l[0] + 1, x2 = h[0] - 1;
  if (x1 <= x2) {
    out.push({ lo: [x1, l[1], l[2]], hi: [x2, l[1], h[2]] });
    if (h[1] > l[1]) out.push({ lo: [x1, h[1], l[2]], hi: [x2, h[1], h[2]] });
    const y1 = l[1] + 1, y2 = h[1] - 1;
    if (y1 <= y2) {
      out.push({ lo: [x1, y1, l[2]], hi: [x2, y2, l[2]] });
      if (h[2] > l[2]) out.push({ lo: [x1, y1, h[2]], hi: [x2, y2, h[2]] });
    }
  }
  return out;
}

/** fill をパレットで行う。mode は replace / hollow / outline のみ（keep・destroy は不可） */
export function paletteFill(a: Vec, b: Vec, mode: string, palette: Palette, seed = 1): string[] {
  if (mode === "replace") return paletteCmds(fillCmds(a, b, "stone"), palette, seed);
  if (mode !== "hollow" && mode !== "outline") throw new Error(`パレットは mode が replace / hollow / outline のときだけ使えます（指定: ${mode}）`);
  const l = lo(a, b), h = hi(a, b);
  const shell = paletteCmds(shellBoxes(a, b).flatMap((x) => fillCmds(x.lo, x.hi, "stone")), palette, seed);
  const inner = h.every((v, i) => v - l[i]! >= 2);
  // hollow は内側を空気にするので、表面を置く前に内側を空ける
  return mode === "hollow" && inner
    ? [...fillCmds([l[0] + 1, l[1] + 1, l[2] + 1], [h[0] - 1, h[1] - 1, h[2] - 1], "air"), ...shell]
    : shell;
}
