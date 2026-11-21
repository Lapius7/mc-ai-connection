// 書き換え操作の共通処理: 禁止リスト → ドライラン → 退避 → 実行 → 要約
import type { Settings } from "./config.ts";
import { History, entryLine, type Entry } from "./history.ts";
import { backupBoxes, describeBox, planCommands } from "./plan.ts";
import { denied, type Policy } from "./policy.ts";
import { logLine, type LogRecord, type OpLog } from "./oplog.ts";
import type { Runner } from "./types.ts";

export type Result = { text: string; isError?: boolean };
const ok = (text: string): Result => ({ text });
const err = (text: string): Result => ({ text, isError: true });

const FAILED = /^(Unknown|Incorrect|Expected|Invalid|Could not|That position|No )/i;
const isFailure = (r: string) => FAILED.test(r) || /<--\[HERE\]/.test(r);

/** コマンド列を順に実行し、要約だけ返す（出力を膨らませない） */
export async function execAll(rcon: Runner, cmds: string[]): Promise<{ ok: number; errors: string[] }> {
  let n = 0;
  const errors: string[] = [];
  for (const c of cmds) {
    const r = await rcon.command(c);
    if (isFailure(r)) {
      if (errors.length < 3) errors.push(`${c} → ${r}`);
    } else n++;
  }
  return { ok: n, errors };
}

const summary = (cmds: string[], r: { ok: number; errors: string[] }) =>
  `実行 ${cmds.length} 件 / 成功 ${r.ok} 件` + (r.errors.length ? `\n失敗例:\n${r.errors.join("\n")}` : "");

/** run_command / run_commands 用。巻き戻しの対象外で、禁止リストだけ適用する */
export async function runPlain(
  rcon: Runner, policy: Policy, cmds: string[], log?: LogTarget,
): Promise<Result> {
  const d = denied(policy, cmds);
  if (d.length) {
    log?.log.append({ server: log.server, tool: log.tool, status: "denied", summary: `${cmds.length} 件`, detail: d.join("; ") });
    return err(`実行しませんでした（禁止・許可リスト）:\n${d.join("\n")}`);
  }
  const r = await execAll(rcon, cmds);
  log?.log.append({
    server: log.server, tool: log.tool, status: "done", summary: cmds[0]!.slice(0, 80) + (cmds.length > 1 ? " ほか" : ""),
    commands: cmds.length, succeeded: r.ok, detail: r.errors[0],
  });
  return ok(summary(cmds, r));
}

export type LogTarget = { log: OpLog; server: string; tool: string };

export type MutateCtx = { rcon: Runner; policy: Policy; settings: Settings; history: History; log?: OpLog; server?: string };

/** fill / build_* / set_block 用。実行前に元ブロックを退避し、履歴に積む */
export function mutate(
  ctx: MutateCtx, tool: string, desc: string, cmds: string[], dryRun: boolean,
): Promise<Result> {
  return ctx.history.exclusive(() => mutateNow(ctx, tool, desc, cmds, dryRun));
}

async function mutateNow(
  ctx: MutateCtx, tool: string, desc: string, cmds: string[], dryRun: boolean,
): Promise<Result> {
  const rec = (r: Omit<LogRecord, "time" | "server" | "tool">) =>
    ctx.log?.append({ server: ctx.server ?? "", tool, ...r });
  const d = denied(ctx.policy, cmds);
  if (d.length) {
    rec({ status: "denied", summary: desc, detail: d.join("; ") });
    return err(`実行しませんでした（禁止・許可リスト）:\n${d.join("\n")}`);
  }
  const plan = planCommands(cmds);
  const undo = ctx.settings.undo;
  const boxes = undo.enabled ? backupBoxes(plan, undo.maxVolume) : [];

  if (dryRun) {
    rec({ status: "dry-run", summary: desc, commands: plan.commands });
    return ok([
      `ドライラン（何も実行していません）: ${desc}`,
      `コマンド ${plan.commands} 件 / 変更ブロック数 最大 ${plan.blocks}（hollow・outline・keep では実際はこれ以下）`,
      `範囲 ${describeBox(plan.bbox)}`,
      undo.enabled ? `巻き戻し用に ${boxes.length} 区画を退避します` : "巻き戻しは無効です",
    ].join("\n"));
  }

  let entry: Entry | null = null;
  if (undo.enabled) {
    try {
      entry = await ctx.history.begin(ctx.rcon, { tool, summary: desc, blocks: plan.blocks }, boxes);
    } catch (e) {
      rec({ status: "failed", summary: desc, detail: e instanceof Error ? e.message : String(e) });
      return err(e instanceof Error ? e.message : String(e));
    }
  }
  try {
    const r = await execAll(ctx.rcon, cmds);
    rec({ status: "done", summary: desc, commands: cmds.length, succeeded: r.ok, historyId: entry?.id, detail: r.errors[0] });
    return ok(summary(cmds, r) + (entry ? `\n履歴 #${entry.id}（undo で元に戻せます）` : ""));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    rec({ status: "failed", summary: desc, historyId: entry?.id, detail: msg });
    return err(`${msg}${entry ? `\n途中まで書き換わった可能性があります。履歴 #${entry.id} を undo で戻せます` : ""}`);
  }
}

export function undoOps(rcon: Runner, history: History, steps: number, log?: LogTarget): Promise<Result> {
  return history.exclusive(() => undoNow(rcon, history, steps, log));
}

async function undoNow(rcon: Runner, history: History, steps: number, log?: LogTarget): Promise<Result> {
  if (history.list().length === 0) return err("戻せる履歴がありません");
  const r = await history.undo(rcon, steps);
  for (const e of r.restored) log?.log.append({ server: log.server, tool: "undo", status: "undo", summary: `${e.tool}: ${e.summary}`, historyId: e.id });
  if (r.error) log?.log.append({ server: log.server, tool: "undo", status: "failed", summary: "undo", detail: r.error });
  const lines = r.restored.map(entryLine);
  const text = (lines.length ? `元に戻しました:\n${lines.join("\n")}` : "") + (r.error ? `${lines.length ? "\n" : ""}${r.error}` : "");
  return r.error ? err(text) : ok(text);
}

export function listOps(history: History, server: string): Result {
  const l = history.list();
  return ok(l.length ? `サーバー ${server} の履歴（新しい順。undo は上から戻る）:\n${l.map(entryLine).join("\n")}` : `サーバー ${server} に履歴はありません`);
}

export function logOps(log: OpLog, n: number, server?: string): Result {
  if (!log.path) return ok("操作ログは無効です");
  const l = log.tail(n, server);
  return ok(l.length ? `操作ログ（新しい順、${log.path}）:\n${l.map(logLine).join("\n")}` : "操作ログはまだありません");
}
