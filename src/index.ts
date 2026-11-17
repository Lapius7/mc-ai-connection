#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as B from "./builders.ts";
import { getRcon, listServers, useServer } from "./servers.ts";
import type { Rcon } from "./rcon.ts";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

/** コマンド列を実行し、要約だけ返す（出力を膨らませない） */
async function runAll(rcon: Rcon, cmds: string[]) {
  let ok = 0;
  const errors: string[] = [];
  for (const c of cmds) {
    const r = await rcon.command(c);
    if (/^(Unknown|Incorrect|Expected|Invalid|Could not|That position|No )/i.test(r) || /<--\[HERE\]/.test(r)) {
      if (errors.length < 3) errors.push(`${c} → ${r}`);
    } else ok++;
  }
  return text(`実行 ${cmds.length} 件 / 成功 ${ok} 件` + (errors.length ? `\n失敗例:\n${errors.join("\n")}` : ""));
}

const serverArg = z.string().optional()
  .describe("対象のサーバー名。省くと現在の既定（list_servers で確認、use_server で切替）");
const num = z.number().int();
const vec = z.tuple([num, num, num]).describe("[x, y, z] の絶対座標");
const block = z.string().describe("例: stone, oak_planks, minecraft:glass, oak_stairs[facing=north]");

const server = new McpServer({ name: "mc-ai-connection", version: "0.2.0" });

/** 各ツールの共通処理。サーバーを解決し、接続や設定の失敗は isError で返す */
const on = <A extends { server?: string }>(fn: (rcon: Rcon, a: A) => Promise<ReturnType<typeof text>>) =>
  async (a: A) => {
    try {
      return await fn(await getRcon(a.server), a);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };

function guard(volume: number) {
  return volume > B.MAX_VOLUME
    ? fail(`体積 ${volume} が上限 ${B.MAX_VOLUME} を超えています（MC_MAX_VOLUME で変更可）`)
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
  description: "Minecraft のコマンドを1つ実行する（先頭の / は不要）。結果の文字列を返す。",
  inputSchema: { command: z.string(), server: serverArg },
}, on(async (rcon, { command }: { command: string; server?: string }) =>
  text((await rcon.command(command)) || "(出力なし)")));

server.registerTool("get_player_pos", {
  description: "プレイヤーの現在位置・向きを取得する。建築の基準座標を決めるときに最初に呼ぶ。",
  inputSchema: { player: z.string().describe("プレイヤー名"), server: serverArg },
}, on(async (rcon, { player }: { player: string; server?: string }) => {
  const pos = await rcon.command(`data get entity ${player} Pos`);
  const rot = await rcon.command(`data get entity ${player} Rotation`);
  const dim = await rcon.command(`data get entity ${player} Dimension`);
  return text(`${pos}\n${rot}\n${dim}`);
}));

server.registerTool("set_block", {
  description: "ブロックを1つ置く。",
  inputSchema: { pos: vec, block, server: serverArg },
}, on(async (rcon, { pos, block }: { pos: number[]; block: string; server?: string }) =>
  runAll(rcon, [`setblock ${pos.join(" ")} ${block}`])));

server.registerTool("fill", {
  description: "直方体を埋める。大きい場合は自動で分割する。mode: replace/hollow/outline/keep/destroy",
  inputSchema: {
    from: vec, to: vec, block,
    mode: z.enum(["replace", "hollow", "outline", "keep", "destroy"]).default("replace"),
    server: serverArg,
  },
}, on(async (rcon, { from, to, block, mode }: any) =>
  guard(B.volume(from, to)) ?? runAll(rcon, B.fillCmds(from, to, block, mode))));

server.registerTool("build_sphere", {
  description: "球を作る。中心と半径を指定。hollow=true で空洞。",
  inputSchema: { center: vec, radius: z.number().int().min(1).max(60), block, hollow: z.boolean().default(false), server: serverArg },
}, on(async (rcon, { center, radius, block, hollow }: any) =>
  guard(((4 / 3) * Math.PI * radius ** 3) | 0) ?? runAll(rcon, B.sphereCmds(center, radius, block, hollow))));

server.registerTool("build_cylinder", {
  description: "円柱を作る。base は底面の中心、height は高さ。塔や柱に使う。",
  inputSchema: { base: vec, radius: z.number().int().min(1).max(60), height: z.number().int().min(1).max(320), block, hollow: z.boolean().default(false), server: serverArg },
}, on(async (rcon, { base, radius, height, block, hollow }: any) =>
  guard(Math.PI * radius * radius * height | 0) ?? runAll(rcon, B.cylinderCmds(base, radius, height, block, hollow))));

server.registerTool("build_line", {
  description: "2点間に直線を引く（橋・柱・梁など）。",
  inputSchema: { from: vec, to: vec, block, server: serverArg },
}, on(async (rcon, { from, to, block }: any) => runAll(rcon, B.lineCmds(from, to, block))));

server.registerTool("run_commands", {
  description: "複数コマンドをまとめて実行する（最大 2000 件）。細かい装飾や家具の配置に使う。",
  inputSchema: { commands: z.array(z.string()).min(1).max(2000), server: serverArg },
}, on(async (rcon, { commands }: { commands: string[]; server?: string }) => runAll(rcon, commands)));

await server.connect(new StdioServerTransport());
