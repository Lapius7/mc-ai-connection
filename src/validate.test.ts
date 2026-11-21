import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings } from "./config.ts";
import { FakeWorld } from "./fakeWorld.ts";
import { History } from "./history.ts";
import { mutate } from "./ops.ts";
import { DEFAULT_DENY } from "./policy.ts";
import { prepare } from "./validate.ts";
import { blocksFor, compareVersions, renameFor, yRange } from "./versions.ts";

describe("versions", () => {
  test("バージョンの比較（26.1 は 1.21.11 より新しい）", () => {
    expect(compareVersions("1.21.4", "1.9")).toBeGreaterThan(0);
    expect(compareVersions("26.1", "1.21.11")).toBeGreaterThan(0);
    expect(compareVersions("1.20", "1.20.0")).toBe(0);
  });
  test("版ごとのブロック名", () => {
    expect(blocksFor("1.16.5")!.has("grass_path")).toBe(true);
    expect(blocksFor("1.17")!.has("dirt_path")).toBe(true);
    expect(blocksFor("1.17")!.has("grass_path")).toBe(false);
    expect(blocksFor("1.20.4")!.has("short_grass")).toBe(true);
    expect(blocksFor("1.20.2")!.has("short_grass")).toBe(false);
    expect(blocksFor("1.21.4")!.has("pale_oak_planks")).toBe(true);
    expect(blocksFor("1.20.4")!.has("pale_oak_planks")).toBe(false);
    expect(blocksFor("26.1")!.has("golden_dandelion")).toBe(true);
  });
  test("データにない版は前後の和集合、範囲外は null", () => {
    const b = blocksFor("1.21.2")!; // 1.21.1 と 1.21.3 の間
    expect(b.has("creaking_heart")).toBe(true);
    expect(b.has("stone")).toBe(true);
    expect(blocksFor("1.12")).toBeNull();
    expect(blocksFor("27.9")).toBeNull();
    expect(() => blocksFor("latest")).toThrow();
  });
  test("名前の変更と高さの範囲", () => {
    expect(renameFor("grass", "1.21.4")).toBe("short_grass");
    expect(renameFor("short_grass", "1.20.1")).toBe("grass");
    expect(renameFor("grass", "1.20.1")).toBeNull();
    expect(renameFor("chain", "26.1")).toBe("iron_chain");
    expect(yRange("1.17.1")).toEqual([0, 255]);
    expect(yRange("1.18")).toEqual([-64, 319]);
  });
});

describe("prepare", () => {
  test("version が無ければ素通し", () => {
    const c = ["setblock 0 0 0 nonsense"];
    expect(prepare(c)).toEqual({ cmds: c, notes: [], errors: [] });
  });
  test("存在しないブロックはエラーにして、近い名前を示す", () => {
    const p = prepare(["fill 0 0 0 1 1 1 oak_plank", "setblock 0 0 0 minecraft:stone"], "1.21.4");
    expect(p.errors.length).toBe(1);
    expect(p.errors[0]).toContain("oak_planks");
  });
  test("状態・NBT・タグ・他の名前空間は名前だけ見る", () => {
    const ok = ["setblock 0 0 0 minecraft:oak_stairs[facing=north,half=top]", "setblock 0 0 0 chest{Items:[]}", "fill 0 0 0 1 1 1 stone replace #minecraft:logs", "setblock 0 0 0 mymod:thing"];
    expect(prepare(ok, "1.21.4").errors).toEqual([]);
    expect(prepare(["fill 0 0 0 1 1 1 stone replace bogus"], "1.21.4").errors.length).toBe(1);
  });
  test("名前の変更は読み替え、置換フィルターにも効く", () => {
    const p = prepare(["fill 0 0 0 1 1 1 grass", "fill 0 0 0 1 1 1 stone replace minecraft:grass", "setblock 0 0 0 grass_path"], "1.21.4");
    expect(p.errors).toEqual([]);
    expect(p.cmds[2]).toBe("setblock 0 0 0 dirt_path");
    expect(p.cmds[0]).toBe("fill 0 0 0 1 1 1 short_grass");
    expect(p.cmds[1]).toBe("fill 0 0 0 1 1 1 stone replace minecraft:short_grass");
    expect(p.notes.join()).toContain("short_grass");
    expect(prepare(["setblock 0 0 0 short_grass"], "1.19.4").cmds[0]).toBe("setblock 0 0 0 grass");
  });
  test("高さの範囲外はエラー。範囲外のバージョンは名前を検査しない", () => {
    expect(prepare(["setblock 0 -10 0 stone"], "1.17.1").errors.length).toBe(1);
    expect(prepare(["setblock 0 -10 0 stone"], "1.18").errors).toEqual([]);
    expect(prepare(["fill 0 0 0 1 400 1 stone"], "1.21.4").errors.length).toBe(1);
    const p = prepare(["setblock 0 0 0 whatever"], "27.0");
    expect(p.errors).toEqual([]);
    expect(p.notes[0]).toContain("検査しません");
  });
});

describe("mutate とバージョン", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mc-ver-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const mk = (version?: string) => {
    const world = new FakeWorld();
    const settings = loadSettings(join(dir, "none.json"));
    const history = new History({ dir, server: "s", origin: [29_000_000, 29_000_000], limit: 5, wait: async () => {} });
    return { world, ctx: { rcon: world, policy: { allow: [], deny: DEFAULT_DENY }, settings, history, version } };
  };
  test("不正なブロック名は何も書かずに止める", async () => {
    const { world, ctx } = mk("1.21.4");
    const r = await mutate(ctx, "set_block", "t", ["setblock 0 0 0 stonee"], false);
    expect(r.isError).toBe(true);
    expect(world.log).toEqual([]);
  });
  test("名前を読み替えて実行し、ドライランにも注記する", async () => {
    const { world, ctx } = mk("1.21.4");
    const d = await mutate(ctx, "fill", "t", ["fill 0 0 0 1 0 1 grass"], true);
    expect(d.text).toContain("short_grass");
    const r = await mutate(ctx, "fill", "t", ["fill 0 0 0 1 0 1 grass"], false);
    expect(r.isError).toBeUndefined();
    expect(world.get(1, 0, 1)).toBe("short_grass");
    expect(r.text).toContain("読み替え");
  });
});
