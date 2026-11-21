import { describe, expect, test } from "bun:test";
import { FakeWorld } from "./fakeWorld.ts";
import { MARK, paletteCmds, toPalette } from "./palette.ts";
import { planCommands } from "./plan.ts";
import { archCmds, pyramidCmds, roofCmds, spiralStairsCmds, wallsCmds } from "./shapes.ts";

const run = async (cmds: string[], w = new FakeWorld()) => {
  for (const c of cmds) await w.command(c);
  return w;
};
const cells = (w: FakeWorld) => [...w.blocks.keys()].map((k) => k.split(",").map(Number) as [number, number, number]);

describe("pyramid", () => {
  test("中身の詰まった四角錐は層ごとに縮む", async () => {
    const w = await run(pyramidCmds([0, 10, 0], 3, "stone", false));
    expect(w.blocks.size).toBe(49 + 25 + 9 + 1);
    expect(w.get(0, 13, 0)).toBe("stone");
    expect(w.get(1, 13, 0)).toBe("air");
    expect(w.get(3, 10, 3)).toBe("stone");
  });
  test("hollow は床を残して中を空ける", async () => {
    const w = await run(pyramidCmds([0, 10, 0], 4, "stone", true));
    expect(w.get(0, 10, 0)).toBe("stone");
    expect(w.get(0, 11, 0)).toBe("air");
    expect(w.get(3, 11, 0)).toBe("stone");
    expect(w.get(0, 14, 0)).toBe("stone");
  });
});

describe("arch", () => {
  test("脚と半円の弧ができ、下は通れる", async () => {
    const w = await run(archCmds([0, 0, 0], "x", 7, 3, 1, 2, "stone"));
    for (let y = 0; y < 3; y++) for (const x of [0, 6]) for (const z of [0, 1]) expect(w.get(x, y, z)).toBe("stone");
    for (let y = 0; y < 3; y++) expect(w.get(3, y, 0)).toBe("air");
    expect(w.get(3, 6, 0)).toBe("stone"); // 頂点
    expect(w.get(3, 5, 0)).toBe("air");
    expect(w.get(2, 5, 1)).toBe("stone");
    // 左右対称
    for (const [x, y, z] of cells(w)) expect(w.get(6 - x, y, z)).toBe("stone");
  });
  test("axis=z は z 方向に開く", async () => {
    const w = await run(archCmds([0, 0, 0], "z", 5, 2, 1, 1, "stone"));
    expect(w.get(0, 0, 0)).toBe("stone");
    expect(w.get(0, 0, 4)).toBe("stone");
    expect(w.get(0, 0, 2)).toBe("air");
  });
});

describe("spiral stairs", () => {
  test("1段ごとに 1 ブロック上がり、隣り合う段はつながる", async () => {
    const cmds = spiralStairsCmds([0, 0, 0], 3, 24, "stone", "oak_log");
    const w = await run(cmds);
    for (let y = 0; y < 24; y++) expect(w.get(0, y, 0)).toBe("oak_log");
    const byY = (y: number) => cells(w).filter((c) => c[1] === y && !(c[0] === 0 && c[2] === 0));
    for (let y = 0; y < 23; y++) {
      const near = byY(y + 1).some((b) => byY(y).some((a) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2])) <= 1));
      expect(near).toBe(true);
    }
    expect(w.get(3, 0, 0) === "stone" || byY(0).length > 0).toBe(true);
  });
  test("柱なしなら中心にも踏み板が入る", async () => {
    const w = await run(spiralStairsCmds([0, 0, 0], 2, 5, "stone", null));
    expect(w.get(0, 3, 0)).toBe("stone");
  });
});

describe("roof", () => {
  test("切妻は長い辺に沿った棟を作り、階段の向きが傾斜に合う", async () => {
    const w = await run(roofCmds([0, 5, 0], [6, 5, 4], "gable", "planks", "oak_stairs", false));
    expect(w.get(3, 7, 2)).toBe("planks"); // 棟
    expect(w.get(3, 5, 0)).toBe("oak_stairs[facing=north]");
    expect(w.get(3, 5, 4)).toBe("oak_stairs[facing=south]");
    expect(w.get(3, 6, 1)).toBe("oak_stairs[facing=north]");
    expect(w.get(3, 6, 2)).toBe("air");
  });
  test("幅が偶数の切妻は、棟の2列が向き合う", async () => {
    const w = await run(roofCmds([0, 0, 0], [5, 0, 3], "gable", "planks", "s", false));
    expect(w.get(2, 1, 1)).toBe("s[facing=north]");
    expect(w.get(2, 1, 2)).toBe("s[facing=south]");
  });
  test("寄棟は層ごとに四方が縮む。solid なら中も埋まる", async () => {
    const w = await run(roofCmds([0, 0, 0], [6, 0, 4], "hip", "b", null, true));
    expect(w.get(3, 2, 2)).toBe("b");
    expect(w.get(0, 1, 0)).toBe("air");
    expect(w.get(3, 1, 2)).toBe("b");
  });
  test("棟が x でなく z に沿う切妻", async () => {
    const w = await run(roofCmds([0, 0, 0], [4, 0, 8], "gable", "b", "s", true));
    expect(w.get(2, 2, 4)).toBe("b");
    expect(w.get(0, 0, 4)).toBe("s[facing=west]");
    expect(w.get(4, 0, 4)).toBe("s[facing=east]");
    expect(w.get(2, 1, 4)).toBe("b"); // solid
  });
});

describe("walls", () => {
  const opts = { height: 5, windowBlock: "glass", windowWidth: 2, windowHeight: 2, sill: 2, spacing: 2 };
  test("四方の壁に窓が等間隔で並び、角と内側は壁・空気のまま", async () => {
    const w = await run(wallsCmds([0, 0, 0], [10, 0, 8], "brick", opts));
    expect(w.get(0, 0, 0)).toBe("brick");
    expect(w.get(5, 1, 4)).toBe("air"); // 内側
    expect(w.get(0, 4, 8)).toBe("brick");
    // 北壁（z=0）の内側 9 ブロックに、窓 2 幅 + 間隔 2 は 2 枚入る
    const glassNorth = cells(w).filter(([, , z]) => z === 0).filter(([x, y, z]) => w.get(x, y, z) === "glass");
    expect(glassNorth.length).toBe(2 * 2 * 2);
    expect(w.get(1, 1, 0)).toBe("brick"); // 窓の下端は sill=2
    expect(cells(w).every(([x, y]) => x >= 0 && x <= 10 && y >= 0 && y <= 4)).toBe(true);
    expect(w.get(0, 3, 4)).not.toBe("air");
  });
  test("出入口は壁に空気の開口を開ける", async () => {
    const w = await run(wallsCmds([0, 0, 0], [10, 0, 8], "brick", { ...opts, door: { side: "south", width: 3, height: 3 } }));
    for (const x of [4, 5, 6]) for (const y of [0, 1, 2]) expect(w.get(x, y, 8)).toBe("air");
    expect(w.get(3, 0, 8)).toBe("brick");
    expect(w.get(5, 3, 8)).toBe("brick");
    const e = await run(wallsCmds([0, 0, 0], [10, 0, 8], "brick", { ...opts, door: { side: "east", width: 1, height: 2, offset: 2 } }));
    expect(e.get(10, 0, 2)).toBe("air");
  });
  test("窓が入らない小さな壁でも壊れない", async () => {
    const w = await run(wallsCmds([0, 0, 0], [2, 0, 2], "brick", opts));
    expect(w.blocks.size).toBeGreaterThan(0);
  });
});

describe("パレットとの組み合わせ", () => {
  test("マーカー以外のブロック（階段・窓・空気）は混ぜずにそのまま通す", async () => {
    const pal = toPalette([{ block: "a" }, { block: "b" }])!;
    const cmds = paletteCmds(wallsCmds([0, 0, 0], [10, 0, 8], MARK, { height: 5, windowBlock: "glass", windowWidth: 2, windowHeight: 2, sill: 2, spacing: 2 }), pal, 3, MARK);
    const w = await run(cmds);
    const kinds = new Set(w.blocks.values());
    expect(kinds).toEqual(new Set(["a", "b", "glass"]));
    const roof = paletteCmds(roofCmds([0, 0, 0], [6, 0, 4], "gable", MARK, "oak_stairs", false), pal, 3, MARK);
    expect(roof.some((c) => c.includes("oak_stairs[facing=north]"))).toBe(true);
    expect(planCommands(roof).blocks).toBe(planCommands(roofCmds([0, 0, 0], [6, 0, 4], "gable", MARK, "oak_stairs", false)).blocks);
  });
});
