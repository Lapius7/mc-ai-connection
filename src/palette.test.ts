import { describe, expect, test } from "bun:test";
import { cylinderCmds, fillCmds, sphereCmds } from "./builders.ts";
import { FakeWorld } from "./fakeWorld.ts";
import { MAX_PALETTE_BLOCKS, paletteCmds, paletteFill, shellBoxes, toPalette } from "./palette.ts";
import { planCommands } from "./plan.ts";

const run = async (cmds: string[]) => {
  const w = new FakeWorld();
  for (const c of cmds) await w.command(c);
  return w;
};
const count = (w: FakeWorld) => {
  const m: Record<string, number> = {};
  for (const b of w.blocks.values()) m[b] = (m[b] ?? 0) + 1;
  return m;
};

describe("palette", () => {
  test("割合に近い比率で混ざり、全マスが埋まる", async () => {
    const pal = toPalette([{ block: "stone", weight: 70 }, { block: "mossy_cobblestone", weight: 30 }])!;
    const cmds = paletteCmds(fillCmds([0, 0, 0], [29, 9, 29], "x"), pal, 7);
    const w = await run(cmds);
    const c = count(w);
    expect(c.stone! + c.mossy_cobblestone!).toBe(30 * 10 * 30);
    expect(c.stone! / 9000).toBeGreaterThan(0.65);
    expect(c.stone! / 9000).toBeLessThan(0.75);
  });
  test("seed が同じなら同じ並び、違えば別の並び", () => {
    const pal = toPalette([{ block: "a" }, { block: "b" }])!;
    const f = (seed: number) => paletteCmds(["fill 0 0 0 9 9 9 x"], pal, seed);
    expect(f(3)).toEqual(f(3));
    expect(f(3)).not.toEqual(f(4));
  });
  test("同じブロックが続く所は1つの fill にまとまる", () => {
    const pal = toPalette([{ block: "a" }])!;
    expect(paletteCmds(["fill 0 0 0 0 0 9 x"], pal)).toEqual(["fill 0 0 0 0 0 9 a"]);
  });
  test("球・円柱・setblock のセル数が変わらない", () => {
    const pal = toPalette([{ block: "a", weight: 1 }, { block: "b", weight: 1 }])!;
    for (const cmds of [sphereCmds([0, 0, 0], 5, "x", true), cylinderCmds([0, 0, 0], 4, 6, "x", false), ["setblock 1 2 3 x"]]) {
      expect(planCommands(paletteCmds(cmds, pal)).blocks).toBe(planCommands(cmds).blocks);
    }
  });
  test("hollow は内側を空け、outline は内側に触れない", async () => {
    const pal = toPalette([{ block: "a" }, { block: "b" }])!;
    const base = new FakeWorld();
    base.set(2, 2, 2, "dirt");
    for (const c of paletteFill([0, 0, 0], [4, 4, 4], "hollow", pal, 1)) await base.command(c);
    expect(base.get(2, 2, 2)).toBe("air");
    expect(base.get(0, 2, 2)).not.toBe("air");
    expect(base.blocks.size).toBe(125 - 27);
    const o = new FakeWorld();
    o.set(2, 2, 2, "dirt");
    for (const c of paletteFill([0, 0, 0], [4, 4, 4], "outline", pal, 1)) await o.command(c);
    expect(o.get(2, 2, 2)).toBe("dirt");
  });
  test("薄い箱でも表面が重複しない", () => {
    for (const [a, b] of [[[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [1, 5, 3]], [[0, 0, 0], [9, 0, 9]], [[0, 0, 0], [2, 2, 2]]] as const) {
      const total = shellBoxes([...a], [...b]).reduce((n, x) => n + (x.hi[0] - x.lo[0] + 1) * (x.hi[1] - x.lo[1] + 1) * (x.hi[2] - x.lo[2] + 1), 0);
      const dims = [0, 1, 2].map((i) => b[i]! - a[i]! + 1);
      const inner = dims.every((d) => d > 2) ? (dims[0]! - 2) * (dims[1]! - 2) * (dims[2]! - 2) : 0;
      expect(total).toBe(dims[0]! * dims[1]! * dims[2]! - inner);
    }
  });
  test("不正な入力は例外", () => {
    expect(() => toPalette([])).toThrow();
    expect(() => toPalette([{ block: "a", weight: 0 }])).toThrow();
    expect(() => paletteFill([0, 0, 0], [1, 1, 1], "keep", toPalette([{ block: "a" }])!)).toThrow();
    expect(() => paletteCmds(["fill 0 0 0 1 1 1 a keep"], toPalette([{ block: "a" }])!)).toThrow();
    expect(() => paletteCmds([`fill 0 0 0 ${MAX_PALETTE_BLOCKS} 0 0 a`], toPalette([{ block: "a" }])!)).toThrow();
    expect(toPalette("stone")).toBeNull();
  });
});
