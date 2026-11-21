// 追加の形状（ピラミッド・アーチ・らせん階段・屋根・窓つきの壁）→ コマンド列（純粋関数）。
// パレットに対応させたいブロックには、呼び出し側が渡した block をそのまま使う
import { lineCmds, type Vec } from "./builders.ts";

const fill = (a: Vec, b: Vec, block: string) =>
  `fill ${Math.min(a[0], b[0])} ${Math.min(a[1], b[1])} ${Math.min(a[2], b[2])} ${Math.max(a[0], b[0])} ${Math.max(a[1], b[1])} ${Math.max(a[2], b[2])} ${block}`;

/** 上から見て枠だけ（内側は空気にする）の長方形。高さ1層ぶん */
function ring(l: Vec, h: Vec, block: string, clearInside: boolean): string[] {
  const out: string[] = [];
  if (clearInside && h[0] - l[0] >= 2 && h[2] - l[2] >= 2)
    out.push(fill([l[0] + 1, l[1], l[2] + 1], [h[0] - 1, h[1], h[2] - 1], "air"));
  out.push(fill([l[0], l[1], l[2]], [h[0], h[1], l[2]], block));
  if (h[2] > l[2]) out.push(fill([l[0], l[1], h[2]], [h[0], h[1], h[2]], block));
  if (h[2] - l[2] >= 2) {
    out.push(fill([l[0], l[1], l[2] + 1], [l[0], h[1], h[2] - 1], block));
    if (h[0] > l[0]) out.push(fill([h[0], l[1], l[2] + 1], [h[0], h[1], h[2] - 1], block));
  }
  return out;
}

/** 四角錐。center は底面の中心、radius は底面の半幅（一辺は 2*radius+1）。hollow は中を空ける（床は残す） */
export function pyramidCmds(center: Vec, radius: number, block: string, hollow: boolean): string[] {
  const out: string[] = [];
  for (let i = 0; i <= radius; i++) {
    const r = radius - i, y = center[1] + i;
    const l: Vec = [center[0] - r, y, center[2] - r], h: Vec = [center[0] + r, y, center[2] + r];
    out.push(...(hollow && i > 0 ? ring(l, h, block, true) : [fill(l, h, block)]));
  }
  return out;
}

/**
 * 半円アーチ。start は一方の脚の最小角、axis はアーチが開く向き（x なら x 方向に width 幅）。
 * legHeight は脚の高さ、wall はアーチの厚み（断面）、depth は奥行き
 */
export function archCmds(
  start: Vec, axis: "x" | "z", width: number, legHeight: number, wall: number, depth: number, block: string,
): string[] {
  const out: string[] = [];
  const R = width / 2, cx = (width - 1) / 2;
  for (let u = 0; u < width; u++) {
    const leg = u < wall || u >= width - wall;
    const ys: number[] = [];
    for (let y = 0; y < legHeight + Math.ceil(R); y++) {
      if (y < legHeight) { if (leg) ys.push(y); continue; }
      const d = Math.hypot(u - cx, y - legHeight + 0.5);
      if (d <= R && d > R - wall) ys.push(y);
    }
    // 連続する高さをまとめる
    for (let i = 0; i < ys.length; ) {
      let e = i;
      while (e + 1 < ys.length && ys[e + 1] === ys[e]! + 1) e++;
      const a: Vec = axis === "x" ? [start[0] + u, start[1] + ys[i]!, start[2]] : [start[0], start[1] + ys[i]!, start[2] + u];
      const b: Vec = axis === "x" ? [a[0], start[1] + ys[e]!, start[2] + depth - 1] : [start[0] + depth - 1, start[1] + ys[e]!, a[2]];
      out.push(fill(a, b, block));
      i = e + 1;
    }
  }
  return out;
}

/** らせん階段。踏み板は 1 段ごとに 1 ブロック上がる（歩くにはジャンプが要る。階段ブロックの向きは扱わない） */
export function spiralStairsCmds(
  center: Vec, radius: number, height: number, block: string, pillar: string | null, clockwise = true,
): string[] {
  const perTurn = Math.max(8, Math.ceil((2 * Math.PI * radius) / 1.2));
  const out: string[] = [];
  if (pillar) out.push(fill(center, [center[0], center[1] + height - 1, center[2]], pillar));
  for (let i = 0; i < height; i++) {
    const a = ((clockwise ? 1 : -1) * 2 * Math.PI * i) / perTurn;
    const tip: Vec = [
      center[0] + Math.round(radius * Math.cos(a)), center[1] + i, center[2] + Math.round(radius * Math.sin(a)),
    ];
    // 中心から外周までを1段ぶんの踏み板にする（柱があるなら、中心のマスは柱のまま）
    const start: Vec = [center[0], tip[1], center[2]];
    for (const c of lineCmds(start, tip, block))
      if (!(pillar && c.startsWith(`setblock ${start.join(" ")} `))) out.push(c);
  }
  return out;
}

export type RoofStyle = "gable" | "hip";

/**
 * 屋根。from/to は屋根の土台（一番下の層）の対角で、y は土台の高さ。
 * gable は長い辺に沿った棟の切妻、hip は四方が傾く寄棟。stair を指定すると、傾斜面を階段ブロックで作る（gable のみ）。
 * solid=false なら傾斜の表面だけ（下は空洞）
 */
export function roofCmds(
  from: Vec, to: Vec, style: RoofStyle, block: string, stair: string | null, solid: boolean,
): string[] {
  const l: Vec = [Math.min(from[0], to[0]), from[1], Math.min(from[2], to[2])];
  const h: Vec = [Math.max(from[0], to[0]), from[1], Math.max(from[2], to[2])];
  const out: string[] = [];
  const dx = h[0] - l[0] + 1, dz = h[2] - l[2] + 1;
  if (style === "hip") {
    for (let k = 0; l[0] + k <= h[0] - k && l[2] + k <= h[2] - k; k++) {
      const a: Vec = [l[0] + k, l[1] + k, l[2] + k], b: Vec = [h[0] - k, l[1] + k, h[2] - k];
      out.push(...(solid ? [fill(a, b, block)] : ring(a, b, block, false)));
    }
    return out;
  }
  // gable: 棟は長い辺に沿う。断面は短い辺方向
  const alongX = dx >= dz;
  const span = alongX ? dz : dx; // 断面の幅
  const lowSide = alongX ? l[2] : l[0];
  const highSide = alongX ? h[2] : h[0];
  const facing = (low: boolean) => alongX ? (low ? "north" : "south") : (low ? "west" : "east");
  const slope = (pos: number, y: number, blk: string) => {
    const a: Vec = alongX ? [l[0], y, pos] : [pos, y, l[2]];
    const b: Vec = alongX ? [h[0], y, pos] : [pos, y, h[2]];
    return fill(a, b, blk);
  };
  for (let k = 0; k < Math.ceil(span / 2); k++) {
    const y = l[1] + k, p1 = lowSide + k, p2 = highSide - k;
    if (p1 === p2) { out.push(slope(p1, y, block)); break; }
    out.push(slope(p1, y, stair ? `${stair}[facing=${facing(true)}]` : block));
    out.push(slope(p2, y, stair ? `${stair}[facing=${facing(false)}]` : block));
    if (solid && p2 - p1 >= 2)
      out.push(alongX ? fill([l[0], y, p1 + 1], [h[0], y, p2 - 1], block) : fill([p1 + 1, y, l[2]], [p2 - 1, y, h[2]], block));
  }
  return out;
}

export type Side = "north" | "south" | "east" | "west";
export type WallsOpts = {
  height: number; windowBlock: string; windowWidth: number; windowHeight: number; sill: number; spacing: number;
  door?: { side: Side; width: number; height: number; offset?: number };
};

/**
 * 四方の壁（床と天井は作らない）と、等間隔の窓、出入口の開口。
 * from/to は外壁の対角で、from の y が床の高さ。壁を先に、窓と開口を後ろに並べる
 */
export function wallsCmds(from: Vec, to: Vec, block: string, o: WallsOpts): string[] {
  const l: Vec = [Math.min(from[0], to[0]), from[1], Math.min(from[2], to[2])];
  const h: Vec = [Math.max(from[0], to[0]), from[1], Math.max(from[2], to[2])];
  const y1 = l[1] + o.height - 1;
  const walls = [
    fill([l[0], l[1], l[2]], [h[0], y1, l[2]], block),
    ...(h[2] > l[2] ? [fill([l[0], l[1], h[2]], [h[0], y1, h[2]], block)] : []),
    ...(h[2] - l[2] >= 2 ? [fill([l[0], l[1], l[2] + 1], [l[0], y1, h[2] - 1], block)] : []),
    ...(h[0] > l[0] && h[2] - l[2] >= 2 ? [fill([h[0], l[1], l[2] + 1], [h[0], y1, h[2] - 1], block)] : []),
  ];
  const out = [...walls];
  const wy0 = l[1] + o.sill, wy1 = Math.min(y1 - 1, wy0 + o.windowHeight - 1);
  /** 壁1枚（角を除く内側の長さ n）に窓を等間隔で並べる */
  const windows = (n: number, put: (u0: number, u1: number) => string) => {
    const cnt = Math.floor((n + o.spacing) / (o.windowWidth + o.spacing));
    if (cnt < 1 || wy1 < wy0) return;
    const used = cnt * o.windowWidth + (cnt - 1) * o.spacing;
    const start = Math.floor((n - used) / 2);
    for (let i = 0; i < cnt; i++) {
      const u0 = start + i * (o.windowWidth + o.spacing);
      out.push(put(u0, u0 + o.windowWidth - 1));
    }
  };
  const nx = h[0] - l[0] - 1, nz = h[2] - l[2] - 1;
  windows(nx, (a, b) => fill([l[0] + 1 + a, wy0, l[2]], [l[0] + 1 + b, wy1, l[2]], o.windowBlock));
  if (h[2] > l[2]) windows(nx, (a, b) => fill([l[0] + 1 + a, wy0, h[2]], [l[0] + 1 + b, wy1, h[2]], o.windowBlock));
  if (nz > 0) {
    windows(nz, (a, b) => fill([l[0], wy0, l[2] + 1 + a], [l[0], wy1, l[2] + 1 + b], o.windowBlock));
    if (h[0] > l[0]) windows(nz, (a, b) => fill([h[0], wy0, l[2] + 1 + a], [h[0], wy1, l[2] + 1 + b], o.windowBlock));
  }
  if (o.door) {
    const d = o.door, dy1 = l[1] + d.height - 1;
    const along = d.side === "north" || d.side === "south";
    const len = along ? h[0] - l[0] + 1 : h[2] - l[2] + 1;
    const c = d.offset ?? Math.floor((len - 1) / 2);
    const u0 = (along ? l[0] : l[2]) + c - Math.floor((d.width - 1) / 2), u1 = u0 + d.width - 1;
    const plane = d.side === "north" ? l[2] : d.side === "south" ? h[2] : d.side === "west" ? l[0] : h[0];
    out.push(along ? fill([u0, l[1], plane], [u1, dy1, plane], "air") : fill([plane, l[1], u0], [plane, dy1, u1], "air"));
  }
  return out;
}
