#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Rcon } from "./rcon.ts";
import * as B from "./builders.ts";

const rcon = new Rcon(
  process.env.MC_RCON_HOST ?? "127.0.0.1",
  Number(process.env.MC_RCON_PORT ?? 25575),
  process.env.MC_RCON_PASSWORD ?? "",
);

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const fail = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

/** コマンド列を実行し、要約だけ返す（出力を膨らませない） */
async function runAll(cmds: string[]) {
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

const num = z.number().int();
const vec = z.tuple([num, num, num]).describe("[x, y, z] の絶対座標");
const block = z.string().describe("例: stone, oak_planks, minecraft:glass, oak_stairs[facing=north]");

const server = new McpServer({ name: "mc-ai-connection", version: "0.1.0" });

function guard(volume: number) {
  return volume > B.MAX_VOLUME
    ? fail(`体積 ${volume} が上限 ${B.MAX_VOLUME} を超えています（MC_MAX_VOLUME で変更可）`)
    : null;
}

server.registerTool("run_command", {
  description: "Minecraft のコマンドを1つ実行する（先頭の / は不要）。結果の文字列を返す。",
  inputSchema: { command: z.string() },
}, async ({ command }) => text((await rcon.command(command)) || "(出力なし)"));

server.registerTool("get_player_pos", {
  description: "プレイヤーの現在位置・向きを取得する。建築の基準座標を決めるときに最初に呼ぶ。",
  inputSchema: { player: z.string().describe("プレイヤー名") },
}, async ({ player }) => {
  const pos = await rcon.command(`data get entity ${player} Pos`);
  const rot = await rcon.command(`data get entity ${player} Rotation`);
  const dim = await rcon.command(`data get entity ${player} Dimension`);
  return text(`${pos}\n${rot}\n${dim}`);
});

server.registerTool("set_block", {
  description: "ブロックを1つ置く。",
  inputSchema: { pos: vec, block },
}, async ({ pos, block }) => runAll([`setblock ${pos.join(" ")} ${block}`]));

server.registerTool("fill", {
  description: "直方体を埋める。大きい場合は自動で分割する。mode: replace/hollow/outline/keep/destroy",
  inputSchema: {
    from: vec, to: vec, block,
    mode: z.enum(["replace", "hollow", "outline", "keep", "destroy"]).default("replace"),
  },
}, async ({ from, to, block, mode }) =>
  guard(B.volume(from, to)) ?? runAll(B.fillCmds(from, to, block, mode)));

server.registerTool("build_sphere", {
  description: "球を作る。中心と半径を指定。hollow=true で空洞。",
  inputSchema: { center: vec, radius: z.number().int().min(1).max(60), block, hollow: z.boolean().default(false) },
}, async ({ center, radius, block, hollow }) =>
  guard(((4 / 3) * Math.PI * radius ** 3) | 0) ?? runAll(B.sphereCmds(center, radius, block, hollow)));

server.registerTool("build_cylinder", {
  description: "円柱を作る。base は底面の中心、height は高さ。塔や柱に使う。",
  inputSchema: { base: vec, radius: z.number().int().min(1).max(60), height: z.number().int().min(1).max(320), block, hollow: z.boolean().default(false) },
}, async ({ base, radius, height, block, hollow }) =>
  guard(Math.PI * radius * radius * height | 0) ?? runAll(B.cylinderCmds(base, radius, height, block, hollow)));

server.registerTool("build_line", {
  description: "2点間に直線を引く（橋・柱・梁など）。",
  inputSchema: { from: vec, to: vec, block },
}, async ({ from, to, block }) => runAll(B.lineCmds(from, to, block)));

server.registerTool("run_commands", {
  description: "複数コマンドをまとめて実行する（最大 2000 件）。細かい装飾や家具の配置に使う。",
  inputSchema: { commands: z.array(z.string()).min(1).max(2000) },
}, async ({ commands }) => runAll(commands));

await server.connect(new StdioServerTransport());
