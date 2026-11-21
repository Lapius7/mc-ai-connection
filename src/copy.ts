// 範囲のコピー＆貼り付け（回転・反転つき）→ clone コマンド列（純粋関数）。
// 回転・反転は 1×高さ×1 の柱ごとの clone で行う。ブロックの向き（facing など）の状態は回転しない
import { hi, lo, splitBox, type Box, type Vec } from "./builders.ts";

export type Rotate = 0 | 90 | 180 | 270;
export type CopyOpts = { rotate: Rotate; flipX: boolean; flipZ: boolean; skipAir: boolean };

/** 柱ごとの clone は件数が増えるので、柱の数に上限を置く */
export const MAX_COLUMNS = Number(process.env.MC_MAX_COPY_COLUMNS ?? 10_000);

const overlaps = (a: Box, b: Box) => [0, 1, 2].every((i) => a.lo[i]! <= b.hi[i]! && b.lo[i]! <= a.hi[i]!);

/** 変換後の大きさ（回転 90・270 では x と z が入れ替わる） */
export function resultSize(a: Vec, b: Vec, rotate: Rotate): Vec {
  const l = lo(a, b), h = hi(a, b);
  const sx = h[0] - l[0] + 1, sy = h[1] - l[1] + 1, sz = h[2] - l[2] + 1;
  return rotate === 90 || rotate === 270 ? [sz, sy, sx] : [sx, sy, sz];
}

/** dest は貼り付け後の箱の最小の角。コピー元と貼り付け先が重なるときは例外 */
export function copyCmds(a: Vec, b: Vec, dest: Vec, o: CopyOpts): string[] {
  const l = lo(a, b), h = hi(a, b);
  const sx = h[0] - l[0] + 1, sy = h[1] - l[1] + 1, sz = h[2] - l[2] + 1;
  const [rx, , rz] = resultSize(a, b, o.rotate);
  const target: Box = { lo: dest, hi: [dest[0] + rx - 1, dest[1] + sy - 1, dest[2] + rz - 1] };
  if (overlaps({ lo: l, hi: h }, target)) throw new Error("コピー元と貼り付け先が重なっています（先に別の場所へ離してください）");
  const mode = o.skipAir ? " masked" : "";
  const src = `${l.join(" ")}`;
  if (o.rotate === 0 && !o.flipX && !o.flipZ) {
    // 変換なしは、そのまま箱ごと clone する（上限に収まるよう分割）
    return splitBox(l, h).map((x) => {
      const off = [0, 1, 2].map((i) => x.lo[i]! - l[i]!);
      return `clone ${x.lo.join(" ")} ${x.hi.join(" ")} ${dest[0] + off[0]!} ${dest[1] + off[1]!} ${dest[2] + off[2]!}${mode}`;
    });
  }
  if (sx * sz > MAX_COLUMNS) throw new Error(`回転・反転する底面 ${sx}×${sz} が大きすぎます（上限 ${MAX_COLUMNS} 柱、MC_MAX_COPY_COLUMNS で変更可）`);
  const out: string[] = [];
  for (let i = 0; i < sx; i++)
    for (let k = 0; k < sz; k++) {
      let x = o.flipX ? sx - 1 - i : i;
      let z = o.flipZ ? sz - 1 - k : k;
      // 上から見て時計回りに回転（x が東、z が南）
      if (o.rotate === 90) [x, z] = [sz - 1 - z, x];
      else if (o.rotate === 180) [x, z] = [sx - 1 - x, sz - 1 - z];
      else if (o.rotate === 270) [x, z] = [z, sx - 1 - x];
      const sxp = l[0] + i, szp = l[2] + k;
      out.push(`clone ${sxp} ${l[1]} ${szp} ${sxp} ${h[1]} ${szp} ${dest[0] + x} ${dest[1]} ${dest[2] + z}${mode}`);
    }
  return out;
}
