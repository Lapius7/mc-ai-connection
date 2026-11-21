import { describe, expect, test } from "bun:test";
import { copyCmds, resultSize, type CopyOpts } from "./copy.ts";
import { FakeWorld } from "./fakeWorld.ts";
import { planCommands } from "./plan.ts";

const base: CopyOpts = { rotate: 0, flipX: false, flipZ: false, skipAir: false };
// 3x2x2 の見本: x 方向に a b c、z=1 側の y=1 に d
async function sample() {
  const w = new FakeWorld();
  w.set(0, 0, 0, "a"); w.set(1, 0, 0, "b"); w.set(2, 0, 0, "c"); w.set(0, 1, 1, "d");
  return w;
}
const apply = async (w: FakeWorld, o: Partial<CopyOpts>, dest: [number, number, number] = [10, 0, 10]) => {
  for (const c of copyCmds([0, 0, 0], [2, 1, 1], dest, { ...base, ...o })) await w.command(c);
  return w;
};

describe("copy", () => {
  test("変換なしはそのままコピー", async () => {
    const w = await apply(await sample(), {});
    expect([w.get(10, 0, 10), w.get(11, 0, 10), w.get(12, 0, 10), w.get(10, 1, 11)]).toEqual(["a", "b", "c", "d"]);
  });
  test("x 反転", async () => {
    const w = await apply(await sample(), { flipX: true });
    expect([w.get(10, 0, 10), w.get(12, 0, 10), w.get(12, 1, 11)]).toEqual(["c", "a", "d"]);
  });
  test("z 反転", async () => {
    const w = await apply(await sample(), { flipZ: true });
    expect([w.get(10, 0, 11), w.get(10, 1, 10)]).toEqual(["a", "d"]);
  });
  test("90 度回転は x と z が入れ替わり、上から見て時計回り", async () => {
    const w = await apply(await sample(), { rotate: 90 });
    // 東向きの a→b→c は南向き（z 増加）に並ぶ。z=1 側にあった d は西側（x 小さい側ではなく z 大→x 小）へ
    expect([w.get(11, 0, 10), w.get(11, 0, 11), w.get(11, 0, 12)]).toEqual(["a", "b", "c"]);
    expect(w.get(10, 1, 10)).toBe("d");
    expect(resultSize([0, 0, 0], [2, 1, 1], 90)).toEqual([2, 2, 3]);
  });
  test("180 度と 270 度", async () => {
    const w180 = await apply(await sample(), { rotate: 180 });
    expect([w180.get(12, 0, 11), w180.get(10, 0, 11)]).toEqual(["a", "c"]);
    const w270 = await apply(await sample(), { rotate: 270 });
    expect([w270.get(10, 0, 12), w270.get(10, 0, 11), w270.get(10, 0, 10)]).toEqual(["a", "b", "c"]);
  });
  test("90 度を4回で元に戻る（変換の整合）", async () => {
    let w = await sample();
    let src: [number, number, number] = [0, 0, 0], size: [number, number, number] = [3, 2, 2];
    for (let n = 0; n < 4; n++) {
      const dest: [number, number, number] = [100 * (n + 1), 0, 0];
      for (const c of copyCmds(src, [src[0] + size[0] - 1, src[1] + size[1] - 1, src[2] + size[2] - 1], dest, { ...base, rotate: 90 })) await w.command(c);
      size = [size[2], size[1], size[0]];
      src = dest;
    }
    expect([w.get(400, 0, 0), w.get(401, 0, 0), w.get(402, 0, 0), w.get(400, 1, 1)]).toEqual(["a", "b", "c", "d"]);
  });
  test("skipAir は空気を上書きしない", async () => {
    const w = await sample();
    w.set(11, 1, 10, "keep");
    await apply(w, { skipAir: true });
    expect(w.get(11, 1, 10)).toBe("keep");
    const w2 = await sample();
    w2.set(11, 1, 10, "keep");
    await apply(w2, {});
    expect(w2.get(11, 1, 10)).toBe("air");
  });
  test("重なる貼り付けと大きすぎる回転は例外", () => {
    expect(() => copyCmds([0, 0, 0], [2, 1, 1], [1, 0, 0], base)).toThrow();
    expect(() => copyCmds([0, 0, 0], [199, 0, 199], [500, 0, 0], { ...base, rotate: 90 })).toThrow();
  });
  test("plan が clone の書き込み先の箱を返す", () => {
    const p = planCommands(copyCmds([0, 0, 0], [2, 1, 1], [10, 0, 10], { ...base, rotate: 90 }));
    expect(p.bbox).toEqual({ lo: [10, 0, 10], hi: [11, 1, 12] });
  });
});
