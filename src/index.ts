#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as B from "./builders.ts";
import { activeServer, getRcon, listServers, useServer } from "./servers.ts";
import type { Rcon } from "./rcon.ts";
import { denied } from "./policy.ts";

import { loadSettings, policyOf, STATE_DIR } from "./config.ts";
import { History } from "./history.ts";
import { formatSummary, summarizeRegion } from "./inspect.ts";
import { listOps, mutate, runPlain, undoOps, type Result } from "./ops.ts";
import { hi, lo } from "./builders.ts";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });
const toMcp = (r: Result) => (r.isError ? fail(r.text) : text(r.text));

const settings = loadSettings();
const policy = policyOf(settings);
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
const block = z.string().describe("例: stone, oak_planks, minecraft:glass, oak_stairs[facing=north]");

const server = new McpServer({ name: "mc-ai-connection", version: "0.2.0" });

type Ctx = { rcon: Rcon; name: string; history: History };

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
  mutate({ rcon: c.rcon, policy, settings, history: c.history }, tool, desc, cmds, dryRun);

function guard(volume: number): Result | null {
  return volume > B.MAX_VOLUME
    ? { text: `体積 ${volume} が上限 ${B.MAX_VOLUME} を超えています（MC_MAX_VOLUME で変更可）`, isError: true }
    : null;
}

server.registerTool("list_servers", {
  description: "登録済みの Minecraft サーバーの一覧と、現在の既定のサーバーを返す。",
  inputSchema: {},
}, async () => text(listServers()
  .map((s) => `${s.active ? "*" : " "} ${s.name}  ${s.target}${s.description ? `  ${s.description}` : ""}`)
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
}, on(async ({ rcon }, { command }: { command: string; server?: string }) => {
  const d = denied(policy, [command]);
  if (d.length) return { text: `実行しませんでした（禁止・許可リスト）:\n${d.join("\n")}`, isError: true };
  return { text: (await rcon.command(command)) || "(出力なし)" };
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
}, on(async (c, { pos, block, dryRun }: { pos: number[]; block: string; dryRun: boolean; server?: string }) =>
  build(c, "set_block", `${pos.join(",")} ${block}`, [`setblock ${pos.join(" ")} ${block}`], dryRun)));

server.registerTool("fill", {
  description: "直方体を埋める。大きい場合は自動で分割する。mode: replace/hollow/outline/keep/destroy。" +
    "実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: {
    from: vec, to: vec, block,
    mode: z.enum(["replace", "hollow", "outline", "keep", "destroy"]).default("replace"),
    dryRun: dryRunArg,
    server: serverArg,
  },
}, on(async (c, { from, to, block, mode, dryRun }: any) =>
  guard(B.volume(from, to)) ?? build(c, "fill", `${from.join(",")} → ${to.join(",")} ${block} ${mode}`, B.fillCmds(from, to, block, mode), dryRun)));

server.registerTool("build_sphere", {
  description: "球を作る。中心と半径を指定。hollow=true で空洞。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { center: vec, radius: z.number().int().min(1).max(60), block, hollow: z.boolean().default(false), dryRun: dryRunArg, server: serverArg },
}, on(async (c, { center, radius, block, hollow, dryRun }: any) =>
  guard(((4 / 3) * Math.PI * radius ** 3) | 0) ?? build(c, "build_sphere", `中心 ${center.join(",")} 半径 ${radius} ${block}`, B.sphereCmds(center, radius, block, hollow), dryRun)));

server.registerTool("build_cylinder", {
  description: "円柱を作る。base は底面の中心、height は高さ。塔や柱に使う。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { base: vec, radius: z.number().int().min(1).max(60), height: z.number().int().min(1).max(320), block, hollow: z.boolean().default(false), dryRun: dryRunArg, server: serverArg },
}, on(async (c, { base, radius, height, block, hollow, dryRun }: any) =>
  guard(Math.PI * radius * radius * height | 0) ?? build(c, "build_cylinder", `底面中心 ${base.join(",")} 半径 ${radius} 高さ ${height} ${block}`, B.cylinderCmds(base, radius, height, block, hollow), dryRun)));

server.registerTool("build_line", {
  description: "2点間に直線を引く（橋・柱・梁など）。実行前に元のブロックを保存し、undo で戻せる。",
  inputSchema: { from: vec, to: vec, block, dryRun: dryRunArg, server: serverArg },
}, on(async (c, { from, to, block, dryRun }: any) =>
  build(c, "build_line", `${from.join(",")} → ${to.join(",")} ${block}`, B.lineCmds(from, to, block), dryRun)));

server.registerTool("run_commands", {
  description: "複数コマンドをまとめて実行する（最大 2000 件）。細かい装飾や家具の配置に使う。" +
    "禁止リストにあるコマンドが1つでもあると、全体を実行しない。このツールの操作は undo で戻せない（戻したい範囲は fill などで作る）。",
  inputSchema: { commands: z.array(z.string()).min(1).max(2000), server: serverArg },
}, on(async ({ rcon }, { commands }: { commands: string[]; server?: string }) => runPlain(rcon, policy, commands)));

server.registerTool("undo", {
  description: "直前の書き換え（set_block / fill / build_*）を元に戻す。新しい順にしか戻せない。" +
    "run_command / run_commands の操作は対象外。履歴はサーバーごと。",
  inputSchema: { steps: z.number().int().min(1).max(50).default(1).describe("戻す操作の数"), server: serverArg },
}, on(async ({ rcon, history }, { steps }: { steps: number; server?: string }) => undoOps(rcon, history, steps)));

server.registerTool("list_history", {
  description: "undo で戻せる書き換えの履歴を新しい順に返す（サーバーごと）。",
  inputSchema: { server: serverArg },
}, on(async ({ name, history }, _a: { server?: string }) => listOps(history, name)));

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
