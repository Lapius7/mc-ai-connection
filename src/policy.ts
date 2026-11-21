// コマンドの許可リスト・禁止リスト（純粋関数）
export type Policy = { allow: string[]; deny: string[] };

/** 既定で拒否するコマンド。設定ファイルの commands.deny で置き換えられる（[] で無効化） */
export const DEFAULT_DENY = ["stop", "op", "deop", "ban", "ban-ip", "pardon", "pardon-ip"];

const words = (s: string) =>
  s.trim().replace(/^\/+/, "").toLowerCase().split(/\s+/).filter(Boolean)
    .map((w, i) => (i === 0 ? w.replace(/^[a-z0-9_.-]+:/, "") : w));

/** execute / return の run 以降を含め、実際に走りうるコマンドをすべて取り出す */
export function effectiveCommands(cmd: string): string[][] {
  let cur = words(cmd);
  const out: string[][] = [cur];
  // 最初の run の後ろだけが子コマンド。その先の引数（say の本文など）は探さない。1段ごとに1回だけ処理する
  while (cur[0] === "execute" || cur[0] === "return") {
    const i = cur.indexOf("run", 1);
    if (i < 0 || i + 1 >= cur.length) break;
    cur = words(cur.slice(i + 1).join(" "));
    out.push(cur);
  }
  return out;
}

const startsWith = (cmd: string[], entry: string[]) =>
  entry.length > 0 && entry.length <= cmd.length && entry.every((e, i) => cmd[i] === e);

/** 拒否するなら理由を、通すなら null を返す */
export function check(policy: Policy, cmd: string): string | null {
  const allow = policy.allow.map(words);
  const deny = policy.deny.map(words);
  for (const c of effectiveCommands(cmd)) {
    if (c.length === 0) return "空のコマンドです";
    if (deny.some((d) => startsWith(c, d))) return `禁止リストにあるコマンドです: ${c[0]}`;
    if (allow.length > 0 && !allow.some((a) => startsWith(c, a)))
      return `許可リストにないコマンドです: ${c[0]}`;
  }
  return null;
}

/** 拒否されたコマンドと理由を最大 n 件返す */
export function denied(policy: Policy, cmds: string[], n = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of cmds) {
    const r = check(policy, c);
    const key = c.split(/\s+/)[0] ?? "";
    if (r && !seen.has(key + r)) {
      seen.add(key + r);
      if (out.length < n) out.push(`${c.length > 60 ? c.slice(0, 60) + "…" : c} → ${r}`);
    }
  }
  return out;
}
