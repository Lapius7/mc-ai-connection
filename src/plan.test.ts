import { describe, expect, test } from "bun:test";
import { cylinderCmds, fillCmds, lineCmds, sphereCmds } from "./builders.ts";
import { backupBoxes, planCommands } from "./plan.ts";

describe("plan", () => {
  test("fill と setblock の範囲と上限ブロック数を求める", () => {
    const p = planCommands(["fill 0 0 0 9 4 9 stone", "setblock 20 1 1 glass"]);
    expect(p.blocks).toBe(10 * 5 * 10 + 1);
    expect(p.bbox).toEqual({ lo: [0, 0, 0], hi: [20, 4, 9] });
  });
  test("範囲を判断できないコマンドは拒否する", () => {
    expect(() => planCommands(["say hi"])).toThrow();
    expect(() => planCommands(["fill ~ ~ ~ ~1 ~1 ~1 stone"])).toThrow();
    expect(() => planCommands([])).toThrow();
  });
  test("大きな fill の分割結果は元の範囲をちょうど覆う", () => {
    const p = planCommands(fillCmds([0, 0, 0], [299, 9, 299], "stone"));
    expect(p.blocks).toBe(300 * 10 * 300);
    expect(p.commands).toBeGreaterThan(1);
  });
  test("退避の箱は 32768 以下で、書き換え範囲を含む", () => {
    for (const cmds of [sphereCmds([0, 64, 0], 20, "stone", false), cylinderCmds([0, 0, 0], 15, 40, "stone", true)]) {
      const p = planCommands(cmds);
      const boxes = backupBoxes(p, 5_000_000);
      for (const b of boxes) expect((b.hi[0] - b.lo[0] + 1) * (b.hi[1] - b.lo[1] + 1) * (b.hi[2] - b.lo[2] + 1)).toBeLessThanOrEqual(32768);
      const covered = (x: number, y: number, z: number) => boxes.some((b) => x >= b.lo[0] && x <= b.hi[0] && y >= b.lo[1] && y <= b.hi[1] && z >= b.lo[2] && z <= b.hi[2]);
      for (const c of cmds.slice(0, 50)) {
        const t = c.split(" ").slice(1, 4).map(Number) as [number, number, number];
        expect(covered(...t)).toBe(true);
      }
    }
  });
  test("斜めの直線は小さな箱で個別に退避する", () => {
    const p = planCommands(lineCmds([0, 0, 0], [100, 100, 100], "stone"));
    const boxes = backupBoxes(p, 1000);
    expect(boxes.length).toBe(p.boxes.length);
  });
  test("上限を超えると例外", () => {
    expect(() => backupBoxes(planCommands(["fill 0 0 0 99 99 99 stone"]), 1000)).toThrow();
  });
});
