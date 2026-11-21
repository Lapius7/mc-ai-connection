// 操作ログ。1行1操作の JSON Lines。巻き戻し履歴の ID を持つので、履歴と突き合わせられる
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";

export type LogRecord = {
  time: string;
  server: string;
  tool: string;
  /** done: 実行 / dry-run: 実行せず / denied: 禁止リストで拒否 / failed: エラー / undo: 巻き戻し */
  status: "done" | "dry-run" | "denied" | "failed" | "undo";
  summary: string;
  commands?: number;
  succeeded?: number;
  /** undo で戻せる履歴の ID（undo の記録では、戻した履歴の ID） */
  historyId?: number;
  detail?: string;
};

const MAX_BYTES = 5 * 1024 * 1024;

export class OpLog {
  constructor(private file: string | null) {}

  get path() {
    return this.file;
  }

  /** ログの失敗で本来の操作を止めない */
  append(r: Omit<LogRecord, "time">) {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      if (existsSync(this.file) && statSync(this.file).size > MAX_BYTES) renameSync(this.file, `${this.file}.1`);
      appendFileSync(this.file, JSON.stringify({ time: new Date().toISOString(), ...r }) + "\n");
    } catch { /* 無視 */ }
  }

  /** 新しい順に最大 n 件。server を指定するとそのサーバーだけ */
  tail(n: number, server?: string): LogRecord[] {
    if (!this.file || !existsSync(this.file)) return [];
    const out: LogRecord[] = [];
    const lines = readFileSync(this.file, "utf8").split("\n");
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      if (!lines[i]) continue;
      try {
        const r = JSON.parse(lines[i]!) as LogRecord;
        if (!server || r.server === server) out.push(r);
      } catch { /* 壊れた行は飛ばす */ }
    }
    return out;
  }
}

export const logLine = (r: LogRecord) =>
  `${r.time.replace("T", " ").slice(0, 19)}  ${r.server}  ${r.tool}  ${r.status}` +
  `${r.historyId ? `  #${r.historyId}` : ""}  ${r.summary}` +
  `${r.commands !== undefined ? `  (${r.succeeded ?? "-"}/${r.commands})` : ""}`;
