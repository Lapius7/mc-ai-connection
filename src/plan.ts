// 実行予定のコマンド列から、書き換わる範囲を求める（純粋関数）
import { hi, lo, splitBox, volume, type Box, type Vec } from "./builders.ts";

export type Plan = {
  commands: number;
  boxes: Box[];
  /** 全体を囲む直方体 */
  bbox: Box;
  /** 書き換わりうるブロック数の上限（hollow / outline / keep では実際はこれ以下） */
  blocks: number;
};

const INT = /^-?\d+$/;
const vecAt = (t: string[], i: number, cmd: string): Vec => {
  const v = t.slice(i, i + 3);
  if (v.length < 3 || !v.every((x) => INT.test(x))) throw new Error(`絶対座標を読めないコマンドです: ${cmd}`);
  return v.map(Number) as Vec;
};

/** fill / setblock / clone だけを受け付ける。ほかは範囲が分からないので例外 */
export function planCommands(cmds: string[]): Plan {
  const boxes: Box[] = [];
  for (const c of cmds) {
    const t = c.trim().replace(/^\//, "").split(/\s+/);
    if (t[0] === "fill") {
      const a = vecAt(t, 1, c), b = vecAt(t, 4, c);
      boxes.push({ lo: lo(a, b), hi: hi(a, b) });
    } else if (t[0] === "setblock") {
      const a = vecAt(t, 1, c);
      boxes.push({ lo: a, hi: a });
    } else if (t[0] === "clone") {
      // 書き込み先の箱（コピー元と同じ大きさ）が書き換わる範囲
      const a = vecAt(t, 1, c), b = vecAt(t, 4, c), d = vecAt(t, 7, c);
      const l = lo(a, b), h = hi(a, b);
      boxes.push({ lo: d, hi: [d[0] + h[0] - l[0], d[1] + h[1] - l[1], d[2] + h[2] - l[2]] });
    } else throw new Error(`範囲を調べられないコマンドです: ${c}`);
  }
  if (boxes.length === 0) throw new Error("コマンドがありません");
  const l = boxes.reduce((m, b) => lo(m, b.lo), boxes[0]!.lo);
  const h = boxes.reduce((m, b) => hi(m, b.hi), boxes[0]!.hi);
  return {
    commands: cmds.length,
    boxes,
    bbox: { lo: l, hi: h },
    blocks: boxes.reduce((n, b) => n + volume(b.lo, b.hi), 0),
  };
}

/**
 * バックアップする箱を決める。ばらばらの小さな箱が多いとき（直線など）は個別に、
 * 密な形（球・円柱・直方体）は全体を囲む1つの箱にして、どちらも FILL_LIMIT 以下に分割する
 */
export function backupBoxes(plan: Plan, maxVolume: number): Box[] {
  const bboxVol = volume(plan.bbox.lo, plan.bbox.hi);
  const dense = bboxVol <= plan.blocks * 8 || plan.boxes.length > 2000;
  const boxes = dense ? [plan.bbox] : plan.boxes;
  const total = boxes.reduce((n, b) => n + volume(b.lo, b.hi), 0);
  if (total > maxVolume)
    throw new Error(`バックアップ対象 ${total} ブロックが上限 ${maxVolume} を超えます（範囲を分けてください）`);
  return boxes.flatMap((b) => splitBox(b.lo, b.hi));
}

export const describeBox = (b: Box) => `[${b.lo.join(", ")}] → [${b.hi.join(", ")}]`;
