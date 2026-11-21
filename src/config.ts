// 動作設定（servers.json とは別）。~/.config/mc-ai-connection/config.json か MC_CONFIG_FILE
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { DEFAULT_DENY, type Policy } from "./policy.ts";

const Settings = z.object({
  commands: z.object({
    /** 空なら制限なし。値があると、ここに前方一致するコマンドだけ通す（例: "fill", "time set"） */
    allow: z.array(z.string()).default([]),
    /** 前方一致で拒否する。省くと既定（stop/op/ban など）。[] にすると無効 */
    deny: z.array(z.string()).default(DEFAULT_DENY),
  }).default({ allow: [], deny: DEFAULT_DENY }),
  undo: z.object({
    enabled: z.boolean().default(true),
    /** 履歴の保持件数（サーバーごと） */
    limit: z.number().int().min(1).max(500).default(20),
    /** バックアップ置き場の [x, z]。ワールドボーダー内で、16 の倍数にする */
    origin: z.tuple([z.number().int(), z.number().int()]).default([29_000_000, 29_000_000]),
    /** 1操作でバックアップできる最大ブロック数 */
    maxVolume: z.number().int().min(1).default(2_000_000),
  }).default({ enabled: true, limit: 20, origin: [29_000_000, 29_000_000], maxVolume: 2_000_000 }),
});
export type Settings = z.infer<typeof Settings>;

export const SETTINGS_PATH =
  process.env.MC_CONFIG_FILE ?? join(homedir(), ".config", "mc-ai-connection", "config.json");
export const STATE_DIR =
  process.env.MC_STATE_DIR ?? join(homedir(), ".local", "state", "mc-ai-connection");

export function loadSettings(path = SETTINGS_PATH): Settings {
  if (!existsSync(path)) return Settings.parse({});
  try {
    return Settings.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    throw new Error(`${path} を読めません: ${e instanceof Error ? e.message : e}`);
  }
}

export const policyOf = (s: Settings): Policy => s.commands;
