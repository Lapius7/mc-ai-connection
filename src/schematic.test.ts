import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { FakeWorld } from "./fakeWorld.ts";
import { parseNbt } from "./nbt.ts";
import { parseSchematic, schematicCmds } from "./schematic.ts";

// テスト用の最小 NBT 書き出し
type V = { t: number; v: any };
const B = (n: number): V => ({ t: 1, v: n }), I = (n: number): V => ({ t: 3, v: n }), S = (s: string): V => ({ t: 8, v: s });
const BA = (a: number[]): V => ({ t: 7, v: a }), C = (o: Record<string, V>): V => ({ t: 10, v: o });
const L = (t: number, a: V[]): V => ({ t: 9, v: { t, a } });
function enc(v: V, out: number[]) {
  const str = (s: string) => { const b = Buffer.from(s); out.push(b.length >> 8, b.length & 255, ...b); };
  const i32 = (n: number) => out.push((n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  switch (v.t) {
    case 1: out.push(v.v & 255); break;
    case 3: i32(v.v); break;
    case 8: str(v.v); break;
    case 7: i32(v.v.length); out.push(...v.v.map((x: number) => x & 255)); break;
    case 9: out.push(v.v.t); i32(v.v.a.length); v.v.a.forEach((x: V) => enc(x, out)); break;
    case 10: for (const [k, x] of Object.entries(v.v as Record<string, V>)) { out.push(x.t); str(k); enc(x, out); } out.push(0); break;
  }
}
const file = (root: V, gz = true) => { const o: number[] = [10, 0, 0]; enc(root, o); const b = Buffer.from(o); return new Uint8Array(gz ? gzipSync(b) : b); };

const run = async (cmds: string[]) => { const w = new FakeWorld(); for (const c of cmds) await w.command(c); return w; };

describe("nbt / schematic", () => {
  test("Sponge v2: varint のブロックデータを読み、空気は置かない", async () => {
    // 3x1x2（幅 3, 高さ 1, 奥行 2）: z=0: stone stone air / z=1: oak_stairs[facing=north] air stone
    const s = parseSchematic(file(C({
      Version: I(2), Width: I(3), Height: I(1), Length: I(2),
      Palette: C({ "minecraft:air": I(0), "minecraft:stone": I(1), "minecraft:oak_stairs[facing=north]": I(2) }),
      BlockData: BA([1, 1, 0, 2, 0, 1]),
    })));
    expect(s.size).toEqual([3, 1, 2]);
    const cmds = schematicCmds(s, [10, 5, 20]);
    expect(cmds).toEqual([
      "fill 10 5 20 11 5 20 minecraft:stone",
      "setblock 10 5 21 minecraft:oak_stairs[facing=north]",
      "setblock 12 5 21 minecraft:stone",
    ]);
    const w = await run(cmds);
    expect(w.get(11, 5, 20)).toBe("stone");
    expect(w.get(11, 5, 21)).toBe("air");
    expect(schematicCmds(s, [0, 0, 0], true).length).toBe(5);
  });
  test("varint が2バイトになる大きなパレット番号", () => {
    const pal: Record<string, V> = {};
    for (let i = 0; i < 130; i++) pal[`minecraft:b${i}`] = I(i);
    const s = parseSchematic(file(C({ Version: I(2), Width: I(2), Height: I(1), Length: I(1), Palette: C(pal), BlockData: BA([0x81, 0x01, 5]) })));
    expect(s.blocks).toEqual(["minecraft:b129", "minecraft:b5"]);
  });
  test("Sponge v3 は Schematic > Blocks の中を読む", () => {
    const s = parseSchematic(file(C({ Schematic: C({
      Version: I(3), Width: I(1), Height: I(1), Length: I(1),
      Blocks: C({ Palette: C({ "minecraft:dirt": I(0) }), Data: BA([0]) }),
    }) })));
    expect(s.blocks).toEqual(["minecraft:dirt"]);
  });
  test("ストラクチャー .nbt は Properties を [k=v] にし、nbt つきを数える（gzip なしも可）", () => {
    const s = parseSchematic(file(C({
      size: L(3, [I(2), I(1), I(1)]),
      palette: L(10, [C({ Name: S("minecraft:chest"), Properties: C({ facing: S("north"), type: S("single") }) }), C({ Name: S("minecraft:air") })]),
      blocks: L(10, [
        C({ pos: L(3, [I(0), I(0), I(0)]), state: I(0), nbt: C({ Items: L(10, []) }) }),
        C({ pos: L(3, [I(1), I(0), I(0)]), state: I(1) }),
      ]),
    }), false));
    expect(s.blocks).toEqual(["minecraft:chest[facing=north,type=single]", null]);
    expect(s.blockEntitiesSkipped).toBe(1);
  });
  test("壊れた入力・未対応形式は例外", () => {
    expect(() => parseNbt(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => parseNbt(file(C({ a: I(1) })).subarray(0, 8))).toThrow();
    expect(() => parseSchematic(file(C({ Materials: S("Alpha") })))).toThrow(/対応していない/);
    expect(() => parseSchematic(file(C({ Version: I(2), Width: I(2), Height: I(1), Length: I(1), Palette: C({ a: I(0) }), BlockData: BA([0]) })))).toThrow(/体積/);
    expect(() => parseSchematic(file(C({ Version: I(2), Width: I(1), Height: I(1), Length: I(1), Palette: C({ a: I(0) }), BlockData: BA([5]) })))).toThrow(/パレット/);
  });
});
