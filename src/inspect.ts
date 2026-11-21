// 範囲内のブロックの要約。clone の filtered が「条件に合うブロック数」を返すことを使い、
// ブロックを書き換えずに数える（コピー先は退避場所の外れ。終わったら空にする）
import { volume, splitBox, type Box, type Vec } from "./builders.ts";
import type { Runner } from "./types.ts";
import { cloneCount, forceload, sleep, type SleepFn } from "./world.ts";

/** 候補を省いたときに数える代表的なブロック */
export const COMMON_BLOCKS = [
  "air", "stone", "deepslate", "granite", "diorite", "andesite", "tuff", "dirt", "grass_block", "coarse_dirt", "podzol",
  "mud", "sand", "red_sand", "gravel", "clay", "sandstone", "snow_block", "ice", "packed_ice", "bedrock", "water", "lava",
  "cobblestone", "mossy_cobblestone", "stone_bricks", "bricks", "netherrack", "basalt", "blackstone", "obsidian",
  "oak_log", "spruce_log", "birch_log", "jungle_log", "acacia_log", "dark_oak_log", "cherry_log", "mangrove_log",
  "oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks", "cherry_planks",
  "oak_leaves", "spruce_leaves", "birch_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "cherry_leaves",
  "short_grass", "tall_grass", "glass", "glowstone", "torch", "chest", "crafting_table", "furnace",
  "coal_ore", "iron_ore", "copper_ore", "gold_ore", "redstone_ore", "lapis_ore", "diamond_ore", "emerald_ore",
  "white_wool", "quartz_block", "smooth_stone", "terracotta", "white_concrete", "iron_block", "gold_block",
].map((b) => `minecraft:${b}`);

export type Summary = { total: number; counts: [string, number][]; other: number };

const norm = (b: string) => (b.startsWith("#") || b.includes(":") ? b : `minecraft:${b}`);

export async function summarizeRegion(
  rcon: Runner, box: Box, scratch: Vec, candidates: string[] = COMMON_BLOCKS, wait: SleepFn = sleep,
): Promise<Summary> {
  const total = volume(box.lo, box.hi);
  const chunks = splitBox(box.lo, box.hi);
  const names = [...new Set((candidates.length ? candidates : COMMON_BLOCKS).map(norm))];
  const counts = new Map<string, number>();
  let found = 0;

  // コピー先は「最大の小箱」が収まる大きさを、source と同じ高さに取る
  const dim = (i: number) => Math.max(...chunks.map((c) => c.hi[i]! - c.lo[i]! + 1));
  const destFor = (c: Box): Vec => [scratch[0], c.lo[1], scratch[2]];
  const destHi = (c: Box): Vec => [scratch[0] + dim(0) - 1, c.hi[1], scratch[2] + dim(2) - 1];
  const used = chunks.map((c) => ({ lo: destFor(c), hi: destHi(c) }));
  // 作業用のコピー先が調べる範囲に重なると、終わりの後始末でその範囲のブロックを消してしまう
  if (used.some((u) => [0, 1, 2].every((i) => u.lo[i]! <= box.hi[i]! && box.lo[i]! <= u.hi[i]!)))
    throw new Error("調べる範囲が作業用の置き場（undo.origin 付近）と重なっています");

  try {
    for (const u of used) await forceload(rcon, "add", u.lo, u.hi);
    for (const [idx, name] of names.entries()) {
      let n = 0;
      for (const c of chunks) n += await cloneCount(rcon, c.lo, c.hi, destFor(c), `filtered ${name}`, wait);
      if (n > 0) {
        counts.set(name.replace(/^minecraft:/, ""), n);
        // タグは重複して数えうるので、ブロック名のときだけ「残り」の計算に使う
        if (!name.startsWith("#")) found += n;
      }
      // 数え終わっていても、残りにタグ（重複して数えうる）があれば続ける
      if (found >= total && names.slice(idx + 1).every((x) => !x.startsWith("#"))) break;
    }
  } finally {
    for (const u of used) {
      try {
        await rcon.command(`fill ${u.lo.join(" ")} ${u.hi.join(" ")} air`);
        await forceload(rcon, "remove", u.lo, u.hi);
      } catch { /* 後始末の失敗は無視 */ }
    }
  }
  return {
    total,
    counts: [...counts.entries()].sort((a, b) => b[1] - a[1]),
    other: Math.max(0, total - found),
  };
}

export function formatSummary(box: Box, s: Summary, top = 30): string {
  const lines = s.counts.slice(0, top).map(([k, v]) => `${k}: ${v}`);
  if (s.counts.length > top) lines.push(`…ほか ${s.counts.length - top} 種`);
  if (s.other > 0) lines.push(`(候補にないブロック): ${s.other}`);
  return `範囲 [${box.lo.join(", ")}] → [${box.hi.join(", ")}] 合計 ${s.total} ブロック\n${lines.join("\n")}`;
}
