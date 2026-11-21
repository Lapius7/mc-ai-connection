import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillCmds, splitBox, sphereCmds, volume } from "./builders.ts";
import type { Settings } from "./config.ts";
import { loadSettings } from "./config.ts";
import { FakeWorld } from "./fakeWorld.ts";
import { History } from "./history.ts";
import { formatSummary, summarizeRegion } from "./inspect.ts";
import { listOps, logOps, mutate, runPlain, undoOps } from "./ops.ts";
import { OpLog } from "./oplog.ts";
import { check, DEFAULT_DENY, effectiveCommands } from "./policy.ts";

let dir: string;
let world: FakeWorld;
let settings: Settings;
const wait = async () => {};
const mk = (server = "s1", limit = 20) => new History({ dir, server, origin: [29_000_000, 29_000_000], limit, wait });
const ctx = (history: History) => ({ rcon: world, policy: { allow: [], deny: DEFAULT_DENY }, settings, history });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mc-hist-"));
  world = new FakeWorld();
  settings = loadSettings(join(dir, "none.json"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("undo", () => {
  test("fill を戻すと元のブロックに戻り、退避場所は空になる", async () => {
    world.set(1, 5, 1, "oak_planks");
    world.set(2, 5, 2, "chest");
    const h = mk();
    const r = await mutate(ctx(h), "fill", "t", fillCmds([0, 5, 0], [3, 6, 3], "stone"), false);
    expect(r.isError).toBeFalsy();
    expect(world.get(1, 5, 1)).toBe("stone");
    expect(h.list().length).toBe(1);

    const u = await undoOps(world, h, 1);
    expect(u.isError).toBeFalsy();
    expect(world.get(1, 5, 1)).toBe("oak_planks");
    expect(world.get(2, 5, 2)).toBe("chest");
    expect(world.get(0, 5, 0)).toBe("air");
    expect(world.get(3, 6, 3)).toBe("air");
    expect(h.list().length).toBe(0);
    expect([...world.blocks.keys()].filter((k) => Number(k.split(",")[0]) > 1_000_000)).toEqual([]);
    expect(world.forced.size).toBe(0);
  });

  test("複数の操作は新しい順に戻り、steps で複数戻せる", async () => {
    const h = mk();
    await mutate(ctx(h), "fill", "a", ["fill 0 0 0 2 0 2 stone"], false);
    await mutate(ctx(h), "fill", "b", ["fill 0 0 0 2 0 2 glass"], false);
    await mutate(ctx(h), "set_block", "c", ["setblock 1 0 1 dirt"], false);
    expect(h.list().map((e) => e.tool)).toEqual(["set_block", "fill", "fill"]);
    await undoOps(world, h, 1);
    expect(world.get(1, 0, 1)).toBe("glass");
    await undoOps(world, h, 2);
    expect(world.get(1, 0, 1)).toBe("air");
    expect((await undoOps(world, h, 1)).isError).toBe(true);
  });

  test("球・直線も元に戻る", async () => {
    world.set(0, 64, 0, "gold_block");
    world.set(5, 5, 5, "diamond_block");
    const h = mk();
    await mutate(ctx(h), "build_sphere", "s", sphereCmds([0, 64, 0], 4, "stone", false), false);
    await mutate(ctx(h), "build_line", "l", ["setblock 5 5 5 glass", "setblock 6 6 6 glass"], false);
    expect(world.get(5, 5, 5)).toBe("glass");
    await undoOps(world, h, 2);
    expect(world.get(0, 64, 0)).toBe("gold_block");
    expect(world.get(5, 5, 5)).toBe("diamond_block");
    expect(world.get(6, 6, 6)).toBe("air");
    expect(world.get(4, 64, 0)).toBe("air");
  });

  test("履歴はサーバーごとに別で、再起動後も残る", async () => {
    const a = mk("alpha"), b = mk("beta");
    await mutate(ctx(a), "fill", "a", ["fill 0 0 0 1 0 1 stone"], false);
    expect(a.list().length).toBe(1);
    expect(b.list().length).toBe(0);
    expect(mk("alpha").list().length).toBe(1);
    expect((await undoOps(world, mk("alpha"), 1)).isError).toBeFalsy();
    expect(world.get(0, 0, 0)).toBe("air");
  });

  test("履歴の上限を超えた古いものは捨てられる", async () => {
    const h = mk("s", 2);
    for (let i = 0; i < 4; i++) await mutate(ctx(h), "fill", `n${i}`, [`fill ${i} 0 0 ${i} 0 0 stone`], false);
    expect(h.list().map((e) => e.summary)).toEqual(["n3", "n2"]);
  });

  test("読み込み待ち（not loaded）は再試行して成功する", async () => {
    world.notLoadedFor = 2;
    const h = mk();
    const r = await mutate(ctx(h), "fill", "t", ["fill 0 0 0 1 0 1 stone"], false);
    expect(r.isError).toBeFalsy();
    expect(world.get(0, 0, 0)).toBe("stone");
  });

  test("退避に失敗したら何も書き換えず、履歴も積まない", async () => {
    world.failClone = true;
    const h = mk();
    const r = await mutate(ctx(h), "fill", "t", ["fill 0 0 0 1 0 1 stone"], false);
    expect(r.isError).toBe(true);
    expect(world.get(0, 0, 0)).toBe("air");
    expect(world.log.some((c) => c.startsWith("fill 0 0 0"))).toBe(false);
    expect(h.list().length).toBe(0);
  });

  test("戻すのに失敗したら履歴を残し、直ってから戻せる", async () => {
    const h = mk();
    await mutate(ctx(h), "fill", "t", ["fill 0 0 0 1 0 1 stone"], false);
    world.failClone = true;
    const u = await undoOps(world, h, 1);
    expect(u.isError).toBe(true);
    expect(h.list().length).toBe(1);
    world.failClone = false;
    expect((await undoOps(world, h, 1)).isError).toBeFalsy();
    expect(world.get(0, 0, 0)).toBe("air");
  });

  test("undo を無効にすると退避せずに実行する", async () => {
    settings.undo.enabled = false;
    const h = mk();
    const r = await mutate(ctx(h), "fill", "t", ["fill 0 0 0 1 0 1 stone"], false);
    expect(r.text).not.toContain("履歴");
    expect(world.log.some((c) => c.startsWith("clone"))).toBe(false);
    expect(h.list().length).toBe(0);
  });

  test("list_history に内容が出る", async () => {
    const h = mk();
    expect(listOps(h, "s1").text).toContain("履歴はありません");
    await mutate(ctx(h), "fill", "stone を敷く", ["fill 0 0 0 1 0 1 stone"], false);
    expect(listOps(h, "s1").text).toContain("stone を敷く");
  });
});

describe("dry run と禁止リスト", () => {
  test("ドライランは何も実行せず、数と範囲を返す", async () => {
    const h = mk();
    const r = await mutate(ctx(h), "fill", "t", ["fill 0 0 0 9 4 9 stone"], true);
    expect(r.text).toContain("500");
    expect(r.text).toContain("[0, 0, 0] → [9, 4, 9]");
    expect(world.log).toEqual([]);
    expect(h.list().length).toBe(0);
  });
  test("禁止リストにあるコマンドは、ドライランでも本番でも拒否する", async () => {
    const h = mk();
    const c = { ...ctx(h), policy: { allow: ["setblock"], deny: [] } };
    expect((await mutate(c, "fill", "t", ["fill 0 0 0 1 1 1 stone"], true)).isError).toBe(true);
    expect((await mutate(c, "fill", "t", ["fill 0 0 0 1 1 1 stone"], false)).isError).toBe(true);
    expect(world.log).toEqual([]);
  });
  test("run_commands は禁止コマンドが1つでもあれば全体を実行しない", async () => {
    const r = await runPlain(world, { allow: [], deny: DEFAULT_DENY }, ["say hi", "op Steve"]);
    expect(r.isError).toBe(true);
    expect(world.log).toEqual([]);
    const ok = await runPlain(world, { allow: [], deny: DEFAULT_DENY }, ["setblock 0 0 0 stone"]);
    expect(ok.text).toContain("成功 1 件");
  });
});

describe("inspect_region", () => {
  test("ブロックの種類ごとの数を返し、ワールドは変えない", async () => {
    world.set(0, 0, 0, "stone");
    world.set(1, 0, 0, "stone");
    world.set(2, 0, 0, "oak_log");
    world.set(3, 0, 0, "weird_modded_block");
    const box = { lo: [0, 0, 0] as [number, number, number], hi: [3, 1, 1] as [number, number, number] };
    const s = await summarizeRegion(world, box, [29_000_000, 0, 28_000_000], undefined, wait);
    expect(s.total).toBe(16);
    expect(Object.fromEntries(s.counts)).toEqual({ air: 12, stone: 2, oak_log: 1 });
    expect(s.other).toBe(1);
    expect(formatSummary(box, s)).toContain("stone: 2");
    expect(world.get(0, 0, 0)).toBe("stone");
    expect([...world.blocks.keys()].filter((k) => Number(k.split(",")[0]) > 1_000_000)).toEqual([]);
    expect(world.forced.size).toBe(0);
  });
  test("大きな範囲は分割して数える", async () => {
    world.set(150, 0, 150, "stone");
    const box = { lo: [0, 0, 0] as [number, number, number], hi: [199, 1, 199] as [number, number, number] };
    const s = await summarizeRegion(world, box, [29_000_000, 0, 28_000_000], ["stone"], wait);
    expect(s.counts).toEqual([["stone", 1]]);
  });
});

describe("操作ログ", () => {
  test("実行・ドライラン・拒否・undo を記録し、履歴 ID で突き合わせられる", async () => {
    const log = new OpLog(join(dir, "ops.jsonl"));
    const h = mk();
    const c = { ...ctx(h), log, server: "s1" };
    await mutate(c, "fill", "a", ["fill 0 0 0 1 0 1 stone"], true);
    await mutate(c, "fill", "b", ["fill 0 0 0 1 0 1 stone"], false);
    await mutate({ ...c, policy: { allow: [], deny: ["fill"] } }, "fill", "c", ["fill 0 0 0 1 0 1 stone"], false);
    await runPlain(world, c.policy, ["say hi", "setblock 0 0 0 dirt"], { log, server: "s1", tool: "run_commands" });
    await undoOps(world, h, 1, { log, server: "s1", tool: "undo" });
    const r = log.tail(10);
    expect(r.map((x) => x.status)).toEqual(["undo", "done", "denied", "done", "dry-run"]);
    expect(r[3]!.historyId).toBeGreaterThan(0);
    expect(r[0]!.historyId).toBe(r[3]!.historyId);
    expect(log.tail(10, "other")).toEqual([]);
    expect(logOps(log, 3).text).toContain("undo");
  });
  test("無効なときは何も書かず、壊れた行があっても読める", () => {
    expect(new OpLog(null).tail(5)).toEqual([]);
    const f = join(dir, "bad.jsonl");
    writeFileSync(f, "not json\n");
    const log = new OpLog(f);
    log.append({ server: "s", tool: "t", status: "done", summary: "x" });
    expect(log.tail(5).length).toBe(1);
  });
});

describe("レビュー指摘の修正", () => {
  test("Z だけで上限を超える範囲も 32768 以下に分割する", () => {
    const boxes = splitBox([0, 0, 0], [0, 0, 39999]);
    expect(boxes.every((b) => volume(b.lo, b.hi) <= 32768)).toBe(true);
    expect(boxes.reduce((n, b) => n + volume(b.lo, b.hi), 0)).toBe(40000);
  });
  test("バックアップ置き場に重なる範囲は、何も実行せず断る", async () => {
    const h = mk();
    const r = await mutate(ctx(h), "fill", "t", ["fill 29000000 0 29000000 29000000 0 29000000 stone"], false);
    expect(r.isError).toBe(true);
    expect(r.text).toContain("重なっています");
    expect(world.log).toEqual([]);
  });
  test("調べる範囲が作業用の置き場に重なるなら断る", async () => {
    const box = { lo: [29_000_000, 0, 28_000_000] as [number, number, number], hi: [29_000_000, 1, 28_000_000] as [number, number, number] };
    await expect(summarizeRegion(world, box, [29_000_000, 0, 28_000_000], ["stone"], wait)).rejects.toThrow("重なっています");
    expect(world.log).toEqual([]);
  });
  test("ブロック名とタグの両方を求めたとき、数え終わっても後ろのタグを数える", async () => {
    world.set(0, 0, 0, "oak_log");
    const box = { lo: [0, 0, 0] as [number, number, number], hi: [0, 0, 0] as [number, number, number] };
    const s = await summarizeRegion(world, box, [29_000_000, 0, 28_000_000], ["oak_log", "#minecraft:logs"], wait);
    expect(s.counts.map(([k]) => k)).toContain("oak_log");
    expect(world.log.some((c) => c.includes("#minecraft:logs"))).toBe(true);
  });
  test("戻した数が 0 なら履歴を残す", async () => {
    const h = mk();
    await mutate(ctx(h), "fill", "t", ["fill 0 0 0 1 0 1 stone"], false);
    const orig = world.command.bind(world);
    world.command = async (c: string) => (c.startsWith("clone 29000000") ? "Failed to clone" : orig(c));
    const u = await undoOps(world, h, 1);
    expect(u.isError).toBe(true);
    expect(h.list().length).toBe(1);
  });
  test("同時に走る書き換えは1つずつ順に行い、退避が衝突しない", async () => {
    const h = mk();
    await Promise.all([
      mutate(ctx(h), "fill", "a", ["fill 0 0 0 3 0 3 stone"], false),
      mutate(ctx(h), "fill", "b", ["fill 10 0 0 13 0 3 glass"], false),
    ]);
    expect(h.list().length).toBe(2);
    await undoOps(world, h, 2);
    expect(world.get(0, 0, 0)).toBe("air");
    expect(world.get(10, 0, 0)).toBe("air");
  });
  test("execute の入れ子は線形に処理し、say の本文は子コマンド扱いしない", () => {
    const p = { allow: [], deny: ["stop"] };
    expect(check(p, "execute as @a run say please run stop")).toBeNull();
    expect(check(p, "execute as @a run stop")).not.toBeNull();
    const deep = "execute as @a run ".repeat(300) + "say hi";
    expect(effectiveCommands(deep).length).toBeLessThan(400);
  });
});
