// RCON 越しにワールドの範囲を扱う下請け（forceload と clone）
import type { Vec } from "./builders.ts";
import type { Runner } from "./types.ts";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const FORCELOAD_STEP = 256; // 16×16 チャンク ＝ 1コマンドの上限 256 チャンクに収まる
const BAD = /out of|outside|too many|^(unknown|incorrect|expected|invalid)|<--\[here\]/i;

/** 範囲のチャンクを強制ロードする / 解除する。256 チャンクずつ区切る */
export async function forceload(raw: Runner, action: "add" | "remove", lo: Vec, hi: Vec) {
  for (let x = lo[0]; x <= hi[0]; x += FORCELOAD_STEP)
    for (let z = lo[2]; z <= hi[2]; z += FORCELOAD_STEP) {
      const r = await raw.command(
        `forceload ${action} ${x} ${z} ${Math.min(hi[0], x + FORCELOAD_STEP - 1)} ${Math.min(hi[2], z + FORCELOAD_STEP - 1)}`);
      if (BAD.test(r)) throw new Error(`forceload ${action} に失敗: ${r}`);
    }
}

export type SleepFn = (ms: number) => Promise<void>;

/**
 * clone を実行し、コピーされたブロック数を返す。0 件なら 0。
 * チャンクが読み込み中のことがあるので、"not loaded" のときだけ待って再試行する
 */
export async function cloneCount(
  raw: Runner, lo: Vec, hi: Vec, dest: Vec, mode = "replace", wait: SleepFn = sleep,
): Promise<number> {
  const cmd = `clone ${lo.join(" ")} ${hi.join(" ")} ${dest.join(" ")} ${mode}`;
  let r = "";
  for (let i = 0; i < 8; i++) {
    r = await raw.command(cmd);
    if (!/not loaded/i.test(r)) break;
    await wait(250);
  }
  const m = /cloned\s+(\d+)/i.exec(r);
  if (m) return Number(m[1]);
  if (/no blocks were cloned|failed to clone/i.test(r)) return 0;
  throw new Error(`clone に失敗: ${r || "(応答なし)"}`);
}
