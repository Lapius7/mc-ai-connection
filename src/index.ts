#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as B from "./builders.ts";
import { activeServer, getRcon, listServers, serverVersion, useServer } from "./servers.ts";
import type { Rcon } from "./rcon.ts";
import { denied } from "./policy.ts";

import { loadSettings, policyOf, STATE_DIR } from "./config.ts";
import { History } from "./history.ts";
import { formatSummary, summarizeRegion } from "./inspect.ts";
import { listOps, logOps, mutate, runPlain, undoOps, type Result } from "./ops.ts";
import { MARK, describePalette, paletteCmds, paletteFill, toPalette, type BlockInput } from "./palette.ts";
import { planCommands } from "./plan.ts";
import * as S from "./shapes.ts";
import { copyCmds, resultSize } from "./copy.ts";
import { loadSchematic, schematicCmds } from "./schematic.ts";
import { OpLog } from "./oplog.ts";
import { join } from "node:path";
import { hi, lo } from "./builders.ts";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });
const toMcp = (r: Result) => (r.isError ? fail(r.text) : text(r.text));

const settings = loadSettings();
const policy = policyOf(settings);
const oplog = new OpLog(settings.log.enabled ? settings.log.file ?? join(STATE_DIR, "operations.jsonl") : null);
const histories = new Map<string, History>();
const historyFor = (name: string) => {
  let h = histories.get(name);
  if (!h) {
    h = new History({ dir: STATE_DIR, server: name, origin: settings.undo.origin, limit: settings.undo.limit });
    histories.set(name, h);
  }
  return h;
};

const serverArg = z.string().optional()
  .describe("対象のサーバー名。省くと現在の既定（list_servers で確認、use_server で切替）");
const dryRunArg = z.boolean().default(false)
  .describe("true なら実行せず、変更ブロック数と範囲だけ返す");
const num = z.number().int();
const vec = z.tuple([num, num, num]).describe("[x, y, z] の絶対座標");
const blockOne = z.string().describe("例: stone, oak_planks, minecraft:glass, oak_stairs[facing=north]");
const block = z.union([
  blockOne,
  z.array(z.object({ block: blockOne, weight: z.number().positive().default(1).describe("割合。合計が100でなくてよい") })).min(1).max(20),
]).describe("ブロック名。配列で渡すと割合で混ぜる（例: [{block:\"stone_bricks\",weight:70},{block:\"mossy_stone_bricks\",weight:30}]）");
const seedArg = z.number().int().optional().describe("パレットの乱数の種。同じ値なら同じ並びになる");

const server = new McpServer({ name: "mc-ai-connection", version: "0.2.0" });

type Ctx = { rcon: Rcon; name: string; history: History };
const logTo = (c: Ctx, tool: string) => ({ log: oplog, server: c.name, tool });

/** 各ツールの共通処理。サーバーを解決し、接続や設定の失敗は isError で返す */
const on = <A extends { server?: string }>(fn: (c: Ctx, a: A) => Promise<Result>) =>
  async (a: A) => {
    try {
      const name = a.server ?? activeServer();
      return toMcp(await fn({ rcon: await getRcon(a.server), name, history: historyFor(name) }, a));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

const build = (c: Ctx, tool: string, desc: string, cmds: string[], dryRun: boolean) =>
  mutate({ rcon: c.rcon, policy, settings, history: c.history, log: oplog, server: c.name, version: serverVersion(c.name) }, tool, desc, cmds, dryRun);

/** block が文字列ならそのまま、配列ならパレットで混ぜたコマンドにする */
function withBlock(input: BlockInput, seed: number | undefined, plain: (b: string) => string[]) {
  const pal = toPalette(input);
  return pal ? { cmds: paletteCmds(plain(MARK), pal, seed ?? 1, MARK), label: describePalette(pal) } : { cmds: plain(input as string), label: input as string };
}

function guard(volume: number): Result | null {
  return volume > B.MAX_VOLUME
    ? { text: `体積 ${volume} が上限 ${B.MAX_VOLUME} を超えています（MC_MAX_VOLUME で変更可）`, isError: true }
    : null;
}

server.registerTool("list_servers", {
  description: "登録済みの Minecraft サーバーの一覧と、現在の既定のサーバーを返す。",
  inputSchema: {},
}, async () => text(listServers()
  .map((s) => `${s.active ? "*" : " "} ${s.name}  ${s.target}${s.version ? `  [${s.version}]` : ""}${s.description ? `  ${s.description}` : ""}`)
  .join("\n")));

server.registerTool("use_server", {
  description: "既定のサーバーを切り替える。以降、server を省いた呼び出しはこのサーバーに向く（この MCP の起動中だけ有効）。",
  inputSchema: { name: z.string().describe("list_servers に出る名前") },
}, async ({ name }) => {
  try {
    useServer(name);
    return text(`既定のサーバーを ${name} に切り替えました`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});

server.registerTool("run_command", {
  description: "Minecraft のコマンドを1つ実行する（先頭の / は不要）。結果の文字列を返す。" +
    "禁止リスト（既定で stop / op / ban など）にあるコマンドは拒否される。このツールの操作は undo で戻せない。",
  inputSchema: { command: z.string(), server: serverArg },
}, on(async (c, { command }: { command: string; server?: string }) => {
  const d = denied(policy, [command]);
  if (d.length) {
    oplog.append({ server: c.name, tool: "run_command", status: "denied", summary: command.slice(0, 80), detail: d.join("; ") });
    return { text: `実行しませんでした（禁止・許可リスト）:\n${d.join("\n")}`, isError: true };
  }
  const out = await c.rcon.command(command);
  oplog.append({ server: c.name, tool: "run_command", status: "done", summary: command.slice(0, 80) });
  return { text: out || "(出力なし)" };
}));

server.registerTool("get_player_pos", {
  description: "プレイヤーの現在位置・向きを取得する。建築の基準座標を決めるときに最初に呼ぶ。",
  inputSchema: { player: z.string().describe("プレイヤー名"), server: serverArg },
}, on(async ({ rcon }, { player }: { player: string; server?: string }) => {
  const pos = await rcon.command(`data get entity ${player} Pos`);
  const rot = await rcon.command(`data get entity ${player} Rotation`);
  const dim = await rcon.command(`data get entity ${player} Dimension`);
  return { text: `${pos}\n${rot}\n${dim}` };
}));

server.registerTool("set_block", {
  description: "ブロックを1つ置く。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { pos: vec, block, dryRun: dryRunArg, server: serverArg },
}, on(async (c, { pos, block, dryRun }: { pos: number[]; block: BlockInput; dryRun: boolean; server?: string }) => {
  const r = withBlock(block, 1, (b) => [`setblock ${pos.join(" ")} ${b}`]);
  return build(c, "set_block", `${pos.join(",")} ${r.label}`, r.cmds, dryRun);
}));

server.registerTool("fill", {
  description: "直方体を埋める。大きい場合は自動で分割する。mode: replace/hollow/outline/keep/destroy。" +
    "block を配列にすると割合で混ぜる（mode は replace / hollow / outline のみ）。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: {
    from: vec, to: vec, block,
    mode: z.enum(["replace", "hollow", "outline", "keep", "destroy"]).default("replace"),
    seed: seedArg,
    dryRun: dryRunArg,
    server: serverArg,
  },
}, on(async (c, { from, to, block, mode, seed, dryRun }: any) => {
  const g = guard(B.volume(from, to));
  if (g) return g;
  const pal = toPalette(block);
  const cmds = pal ? paletteFill(from, to, mode, pal, seed ?? 1) : B.fillCmds(from, to, block, mode);
  return build(c, "fill", `${from.join(",")} → ${to.join(",")} ${pal ? describePalette(pal) : block} ${mode}`, cmds, dryRun);
}));

server.registerTool("build_sphere", {
  description: "球を作る。中心と半径を指定。hollow=true で空洞。block を配列にすると割合で混ぜる。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { center: vec, radius: z.number().int().min(1).max(60), block, hollow: z.boolean().default(false), seed: seedArg, dryRun: dryRunArg, server: serverArg },
}, on(async (c, { center, radius, block, hollow, seed, dryRun }: any) => {
  const g = guard(((4 / 3) * Math.PI * radius ** 3) | 0);
  if (g) return g;
  const r = withBlock(block, seed, (b) => B.sphereCmds(center, radius, b, hollow));
  return build(c, "build_sphere", `中心 ${center.join(",")} 半径 ${radius} ${r.label}`, r.cmds, dryRun);
}));

server.registerTool("build_cylinder", {
  description: "円柱を作る。base は底面の中心、height は高さ。塔や柱に使う。block を配列にすると割合で混ぜる。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { base: vec, radius: z.number().int().min(1).max(60), height: z.number().int().min(1).max(320), block, hollow: z.boolean().default(false), seed: seedArg, dryRun: dryRunArg, server: serverArg },
}, on(async (c, { base, radius, height, block, hollow, seed, dryRun }: any) => {
  const g = guard(Math.PI * radius * radius * height | 0);
  if (g) return g;
  const r = withBlock(block, seed, (b) => B.cylinderCmds(base, radius, height, b, hollow));
  return build(c, "build_cylinder", `底面中心 ${base.join(",")} 半径 ${radius} 高さ ${height} ${r.label}`, r.cmds, dryRun);
}));

server.registerTool("build_line", {
  description: "2点間に直線を引く（橋・柱・梁など）。block を配列にすると割合で混ぜる。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { from: vec, to: vec, block, seed: seedArg, dryRun: dryRunArg, server: serverArg },
}, on(async (c, { from, to, block, seed, dryRun }: any) => {
  const r = withBlock(block, seed, (b) => B.lineCmds(from, to, b));
  return build(c, "build_line", `${from.join(",")} → ${to.join(",")} ${r.label}`, r.cmds, dryRun);
}));

const shapeTool = (c: Ctx, tool: string, desc: string, input: BlockInput, seed: number | undefined, dryRun: boolean, plain: (b: string) => string[]) => {
  const r = withBlock(input, seed, plain);
  return guard(planCommands(r.cmds).blocks) ?? build(c, tool, `${desc} ${r.label}`, r.cmds, dryRun);
};

server.registerTool("build_pyramid", {
  description: "四角錐を作る。center は底面の中心、radius は底面の半幅（一辺は 2*radius+1）。hollow=true で中を空ける。block を配列にすると割合で混ぜる。undo で戻せる。",
  inputSchema: { center: vec, radius: z.number().int().min(1).max(60), block, hollow: z.boolean().default(false), seed: seedArg, dryRun: dryRunArg, server: serverArg },
}, on(async (c, { center, radius, block, hollow, seed, dryRun }: any) =>
  shapeTool(c, "build_pyramid", `中心 ${center.join(",")} 半径 ${radius}`, block, seed, dryRun, (b) => S.pyramidCmds(center, radius, b, hollow))));

server.registerTool("build_arch", {
  description: "半円のアーチを作る。start は一方の脚の最小角の座標。axis=x なら x 方向に width ブロック幅で開き、depth は奥行き（z 方向）。axis=z ならその逆。" +
    "legHeight は脚の高さ、wall は厚み。門・橋の下・回廊に使う。undo で戻せる。",
  inputSchema: {
    start: vec, axis: z.enum(["x", "z"]), width: z.number().int().min(3).max(100), legHeight: z.number().int().min(0).max(100).default(3),
    wall: z.number().int().min(1).max(6).default(1), depth: z.number().int().min(1).max(50).default(1),
    block, seed: seedArg, dryRun: dryRunArg, server: serverArg,
  },
}, on(async (c, { start, axis, width, legHeight, wall, depth, block, seed, dryRun }: any) =>
  shapeTool(c, "build_arch", `始点 ${start.join(",")} ${axis} 幅 ${width}`, block, seed, dryRun, (b) => S.archCmds(start, axis, width, legHeight, wall, depth, b))));

server.registerTool("build_spiral_stairs", {
  description: "らせん階段を作る。center は中心、radius は外周の半径、height は段数（1段ごとに 1 ブロック上がるので、歩くにはジャンプが要る）。" +
    "pillar を指定すると中心に柱を立てる。階段ブロックの向きは扱わない。undo で戻せる。",
  inputSchema: {
    center: vec, radius: z.number().int().min(1).max(30), height: z.number().int().min(1).max(320), block,
    pillar: z.string().optional().describe("中心の柱のブロック。省くと柱なし"),
    clockwise: z.boolean().default(true), seed: seedArg, dryRun: dryRunArg, server: serverArg,
  },
}, on(async (c, { center, radius, height, block, pillar, clockwise, seed, dryRun }: any) =>
  shapeTool(c, "build_spiral_stairs", `中心 ${center.join(",")} 半径 ${radius} ${height} 段`, block, seed, dryRun, (b) => S.spiralStairsCmds(center, radius, height, b, pillar ?? null, clockwise))));

server.registerTool("build_roof", {
  description: "屋根を作る。from/to は屋根の土台（一番下の層）の対角で、y は土台の高さ。" +
    "style=gable は長い辺に沿った切妻、hip は四方が傾く寄棟。stairBlock（例: oak_stairs）を指定すると、切妻の傾斜面を向きつきの階段で作り、棟と寄棟は block で作る。" +
    "solid=true で中も埋める。undo で戻せる。",
  inputSchema: {
    from: vec, to: vec, style: z.enum(["gable", "hip"]).default("gable"), block,
    stairBlock: z.string().optional(), solid: z.boolean().default(false), seed: seedArg, dryRun: dryRunArg, server: serverArg,
  },
}, on(async (c, { from, to, style, block, stairBlock, solid, seed, dryRun }: any) =>
  shapeTool(c, "build_roof", `${from.join(",")} → ${to.join(",")} ${style}`, block, seed, dryRun, (b) => S.roofCmds(from, to, style, b, stairBlock ?? null, solid))));

server.registerTool("build_walls", {
  description: "四方の壁（床と天井は作らない）に、等間隔の窓と出入口の開口をまとめて作る。from/to は外壁の対角で、from の y が床の高さ。" +
    "window 系で窓の大きさ・高さ・間隔を決める。door を渡すと、その壁に開口（空気）を開ける（ドアのブロックは置かない）。undo で戻せる。",
  inputSchema: {
    from: vec, to: vec, height: z.number().int().min(2).max(100), block,
    windowBlock: z.string().default("glass"), windowWidth: z.number().int().min(1).max(10).default(2),
    windowHeight: z.number().int().min(1).max(10).default(2),
    sill: z.number().int().min(1).max(50).default(2).describe("床から窓の下端までの高さ"),
    spacing: z.number().int().min(1).max(10).default(2).describe("窓と窓の間隔"),
    door: z.object({
      side: z.enum(["north", "south", "east", "west"]).describe("north は z が小さい側"),
      width: z.number().int().min(1).max(5).default(1), height: z.number().int().min(1).max(6).default(2),
      offset: z.number().int().min(0).optional().describe("その壁の端から開口の中心までのブロック数。省くと中央"),
    }).optional(),
    seed: seedArg, dryRun: dryRunArg, server: serverArg,
  },
}, on(async (c, { from, to, height, block, windowBlock, windowWidth, windowHeight, sill, spacing, door, seed, dryRun }: any) =>
  shapeTool(c, "build_walls", `${from.join(",")} → ${to.join(",")} 高さ ${height}`, block, seed, dryRun,
    (b) => S.wallsCmds(from, to, b, { height, windowBlock, windowWidth, windowHeight, sill, spacing, door }))));

server.registerTool("copy_region", {
  description: "範囲をコピーして別の場所に貼り付ける（サーバー側の clone）。回転（90 度刻み）と x / z 方向の反転ができる。" +
    "dest は貼り付け後の箱の最小の角（x・y・z がいちばん小さい角）。コピー元と貼り付け先が重なってはいけない。" +
    "回転・反転は 1×高さ×1 の柱ごとに行うので、階段などの向き（facing）は回転しない。チェストなどの中身は引き継ぐ。コピー元のチャンクが読み込まれている必要がある。undo で戻せる。",
  inputSchema: {
    from: vec, to: vec, dest: vec,
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0).describe("上から見て時計回りの角度"),
    flipX: z.boolean().default(false), flipZ: z.boolean().default(false),
    skipAir: z.boolean().default(false).describe("true なら空気を貼り付けず、貼り付け先を残す"),
    dryRun: dryRunArg, server: serverArg,
  },
}, on(async (c, { from, to, dest, rotate, flipX, flipZ, skipAir, dryRun }: any) => {
  const g = guard(B.volume(from, to));
  if (g) return g;
  let cmds: string[];
  try { cmds = copyCmds(from, to, dest, { rotate, flipX, flipZ, skipAir }); }
  catch (e) { return { text: e instanceof Error ? e.message : String(e), isError: true }; }
  const sz = resultSize(from, to, rotate);
  return build(c, "copy_region", `${from.join(",")} → ${to.join(",")} を ${dest.join(",")} へ（${sz.join("×")}、回転 ${rotate}${flipX ? " x反転" : ""}${flipZ ? " z反転" : ""}）`, cmds, dryRun);
}));

server.registerTool("paste_schematic", {
  description: "スキーマティックを指定の座標に貼り付ける。.schem（Sponge v2/v3）とストラクチャーの .nbt に対応（旧 .schematic は不可）。" +
    "path は MCP サーバーを動かしているマシン上のファイル。origin は貼り付け後の箱の最小の角。チェストの中身などブロックエンティティの NBT は貼り付けない（ブロック自体は置く）。" +
    "回転・反転はしない（必要なら先に貼ってから copy_region）。undo で戻せる。",
  inputSchema: {
    path: z.string().describe(".schem または .nbt のファイルパス"), origin: vec,
    includeAir: z.boolean().default(false).describe("true なら空気も置いて、貼り付け先を空にする"),
    dryRun: dryRunArg, server: serverArg,
  },
}, on(async (c, { path, origin, includeAir, dryRun }: any) => {
  let cmds: string[], note = "";
  try {
    const s = loadSchematic(path);
    const g = guard(s.size[0] * s.size[1] * s.size[2]);
    if (g) return g;
    cmds = schematicCmds(s, origin, includeAir);
    if (cmds.length === 0) return { text: "置くブロックがありません（空気だけのスキーマティックです）", isError: true };
    if (s.blockEntitiesSkipped) note = `\n注意: ブロックエンティティ ${s.blockEntitiesSkipped} 個の NBT（中身など）は貼り付けていません`;
    const r = await build(c, "paste_schematic", `${path.split("/").pop()}（${s.size.join("×")}）を ${origin.join(",")} へ`, cmds, dryRun);
    return { ...r, text: r.text + note };
  } catch (e) { return { text: e instanceof Error ? e.message : String(e), isError: true }; }
}));

server.registerTool("run_commands", {
  description: "複数コマンドをまとめて実行する（最大 2000 件）。細かい装飾や家具の配置に使う。" +
    "禁止リストにあるコマンドが1つでもあると、全体を実行しない。このツールの操作は undo で戻せない（戻したい範囲は fill などで作る）。",
  inputSchema: { commands: z.array(z.string()).min(1).max(2000), server: serverArg },
}, on(async (c, { commands }: { commands: string[]; server?: string }) => runPlain(c.rcon, policy, commands, logTo(c, "run_commands"))));

server.registerTool("undo", {
  description: "直前の書き換え（set_block / fill / build_*）を元に戻す。新しい順にしか戻せない。" +
    "run_command / run_commands の操作は対象外。履歴はサーバーごと。",
  inputSchema: { steps: z.number().int().min(1).max(50).default(1).describe("戻す操作の数"), server: serverArg },
}, on(async (c, { steps }: { steps: number; server?: string }) => undoOps(c.rcon, c.history, steps, logTo(c, "undo"))));

server.registerTool("list_history", {
  description: "undo で戻せる書き換えの履歴を新しい順に返す（サーバーごと）。",
  inputSchema: { server: serverArg },
}, on(async ({ name, history }, _a: { server?: string }) => listOps(history, name)));

server.registerTool("operation_log", {
  description: "この MCP が行った操作のログを新しい順に返す（実行・ドライラン・拒否・失敗・undo）。履歴 ID は undo の履歴と同じ。",
  inputSchema: { count: z.number().int().min(1).max(200).default(20), server: z.string().optional().describe("サーバー名で絞る。省くと全サーバー") },
}, async ({ count, server }) => text(logOps(oplog, count, server).text));

server.registerTool("inspect_region", {
  description: "範囲内のブロックの種類ごとの数を返す（読み取りのみ、ブロックは変えない）。" +
    "blocks を省くと代表的な約 80 種を数え、それ以外は「候補にないブロック」にまとめる。",
  inputSchema: {
    from: vec, to: vec,
    blocks: z.array(z.string()).optional().describe("数えたいブロック名（例: oak_log）やタグ（#minecraft:logs）。省くと代表的なもの"),
    server: serverArg,
  },
}, on(async ({ rcon }, { from, to, blocks }: any) => {
  const g = guard(B.volume(from, to));
  if (g) return g;
  const box = { lo: lo(from, to), hi: hi(from, to) };
  const scratch: [number, number, number] = [
    Math.floor(settings.undo.origin[0] / 16) * 16, 0, Math.floor(settings.undo.origin[1] / 16) * 16 - 1_000_000];
  return { text: formatSummary(box, await summarizeRegion(rcon, box, scratch, blocks)) };
}));

await server.connect(new StdioServerTransport());
