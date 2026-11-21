// 複数サーバーの設定と、サーバーごとの RCON 接続の管理
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Rcon } from "./rcon.ts";
import { VERSION_RE } from "./versions.ts";

const ServerConfig = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().default(25575),
  password: z.string().optional(),
  /** パスワードを入れた環境変数の名前（設定ファイルに平文で置きたくないとき） */
  passwordEnv: z.string().optional(),
  /** 指定すると、この SSH ホスト（~/.ssh/config の名前）経由で RCON につなぐ。host と port は SSH 先から見た値 */
  ssh: z.string().optional(),
  description: z.string().optional(),
  /** Minecraft のバージョン（例 "1.21.4"、"26.1"）。指定するとブロック名と高さを実行前に検査し、名前の変更を読み替える */
  version: z.string().regex(VERSION_RE, "例: 1.21.4").optional(),
});
type ServerConfig = z.infer<typeof ServerConfig>;

const ConfigFile = z.object({
  default: z.string().optional(),
  servers: z.record(z.string(), ServerConfig),
});

export const CONFIG_PATH =
  process.env.MC_SERVERS_FILE ?? join(homedir(), ".config", "mc-ai-connection", "servers.json");

function load(): { servers: Record<string, ServerConfig>; active: string } {
  if (existsSync(CONFIG_PATH)) {
    const cfg = ConfigFile.parse(JSON.parse(readFileSync(CONFIG_PATH, "utf8")));
    const names = Object.keys(cfg.servers);
    if (names.length === 0) throw new Error(`${CONFIG_PATH} に servers が1つもありません`);
    const active = cfg.default ?? names[0]!;
    if (!cfg.servers[active]) throw new Error(`default の "${active}" が servers にありません`);
    return { servers: cfg.servers, active };
  }
  // 設定ファイルがなければ、従来どおり環境変数の1台だけで動く
  return {
    servers: {
      default: ServerConfig.parse({
        host: process.env.MC_RCON_HOST ?? "127.0.0.1",
        port: Number(process.env.MC_RCON_PORT ?? 25575),
        password: process.env.MC_RCON_PASSWORD ?? "",
        version: process.env.MC_VERSION || undefined,
      }),
    },
    active: "default",
  };
}

type Tunnel = { proc: ReturnType<typeof Bun.spawn>; localPort: number };

const state = load();
let active = state.active;
const rcons = new Map<string, Rcon>();
const tunnels = new Map<string, Tunnel>();

export const serverNames = () => Object.keys(state.servers);
export const activeServer = () => active;
export const serverVersion = (name: string) => state.servers[name]?.version;

export function listServers() {
  return serverNames().map((name) => {
    const c = state.servers[name]!;
    return {
      name,
      active: name === active,
      target: c.ssh ? `ssh:${c.ssh} → ${c.host}:${c.port}` : `${c.host}:${c.port}`,
      description: c.description ?? "",
      version: c.version ?? "",
    };
  });
}

export function useServer(name: string) {
  if (!state.servers[name]) {
    throw new Error(`サーバー "${name}" は未登録です。登録済み: ${serverNames().join(", ")}`);
  }
  active = name;
}

async function freePort(): Promise<number> {
  const l = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const p = l.port;
  l.stop(true);
  return p;
}

async function canConnect(port: number): Promise<boolean> {
  try {
    const s = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, error() {} } });
    s.end();
    return true;
  } catch {
    return false;
  }
}

async function ensureTunnel(name: string, c: ServerConfig): Promise<number> {
  const cur = tunnels.get(name);
  if (cur && cur.proc.exitCode === null) return cur.localPort;
  rcons.delete(name); // トンネルを張り直すので、古い接続は捨てる
  const localPort = await freePort();
  const proc = Bun.spawn(
    ["ssh", "-N", "-L", `127.0.0.1:${localPort}:${c.host}:${c.port}`,
      "-o", "ExitOnForwardFailure=yes", "-o", "BatchMode=yes",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", c.ssh!],
    { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
  );
  for (let i = 0; i < 50; i++) {
    if (proc.exitCode !== null) throw new Error(`SSH トンネルを張れません（ssh ${c.ssh}）`);
    if (await canConnect(localPort)) {
      tunnels.set(name, { proc, localPort });
      return localPort;
    }
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`SSH トンネルの待ち受けがタイムアウトしました（ssh ${c.ssh}）`);
}

/** 名前の鯖の RCON を返す。name を省くと現在の既定の鯖 */
export async function getRcon(name?: string): Promise<Rcon> {
  const n = name ?? active;
  const c = state.servers[n];
  if (!c) throw new Error(`サーバー "${n}" は未登録です。登録済み: ${serverNames().join(", ")}`);
  let host = c.host;
  let port = c.port;
  if (c.ssh) {
    host = "127.0.0.1";
    port = await ensureTunnel(n, c);
  }
  let r = rcons.get(n);
  if (!r) {
    const password = c.password ?? (c.passwordEnv ? process.env[c.passwordEnv] : undefined) ?? "";
    r = new Rcon(host, port, password);
    rcons.set(n, r);
  }
  return r;
}

function closeTunnels() {
  for (const t of tunnels.values()) t.proc.kill();
}
process.on("exit", closeTunnels);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
