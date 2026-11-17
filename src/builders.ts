// 形状 → Minecraft コマンドの列に変換する（純粋関数）
export const MAX_VOLUME = Number(process.env.MC_MAX_VOLUME ?? 200_000);
const FILL_LIMIT = 32_768;

export type Vec = [number, number, number];
const lo = (a: Vec, b: Vec): Vec => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
const hi = (a: Vec, b: Vec): Vec => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
export const volume = (a: Vec, b: Vec) => {
  const l = lo(a, b), h = hi(a, b);
  return (h[0] - l[0] + 1) * (h[1] - l[1] + 1) * (h[2] - l[2] + 1);
};

/** /fill の 32768 上限に収まるよう Y 方向などで分割する */
export function fillCmds(a: Vec, b: Vec, block: string, mode = ""): string[] {
  const l = lo(a, b), h = hi(a, b);
  const out: string[] = [];
  const dx = h[0] - l[0] + 1, dz = h[2] - l[2] + 1;
  const layers = Math.max(1, Math.floor(FILL_LIMIT / (dx * dz)));
  if (dx * dz <= FILL_LIMIT) {
    for (let y = l[1]; y <= h[1]; y += layers) {
      out.push(`fill ${l[0]} ${y} ${l[2]} ${h[0]} ${Math.min(h[1], y + layers - 1)} ${h[2]} ${block} ${mode}`.trim());
    }
  } else {
    // 底面が大きい場合は X 方向にも切る
    const step = Math.max(1, Math.floor(FILL_LIMIT / dz));
    for (let y = l[1]; y <= h[1]; y++)
      for (let x = l[0]; x <= h[0]; x += step)
        out.push(`fill ${x} ${y} ${l[2]} ${Math.min(h[0], x + step - 1)} ${y} ${h[2]} ${block} ${mode}`.trim());
  }
  return out;
}

export function boxCmds(a: Vec, b: Vec, block: string, hollow: boolean): string[] {
  return fillCmds(a, b, block, hollow ? "hollow" : "replace");
}

/** 球（中心 c、半径 r）。Y ごと・X ごとに Z 方向の帯で埋める */
export function sphereCmds(c: Vec, r: number, block: string, hollow: boolean): string[] {
  const out: string[] = [];
  const inside = (x: number, y: number, z: number, rr: number) => x * x + y * y + z * z <= rr * rr;
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++) {
      const zs: number[] = [];
      for (let dz = -r; dz <= r; dz++) {
        if (!inside(dx, dy, dz, r + 0.5)) continue;
        if (hollow && inside(dx, dy, dz, r - 1 + 0.5) &&
            inside(dx + 1, dy, dz, r - 1 + 0.5) && inside(dx - 1, dy, dz, r - 1 + 0.5) &&
            inside(dx, dy + 1, dz, r - 1 + 0.5) && inside(dx, dy - 1, dz, r - 1 + 0.5) &&
            inside(dx, dy, dz + 1, r - 1 + 0.5) && inside(dx, dy, dz - 1, r - 1 + 0.5)) continue;
        zs.push(dz);
      }
      // 連続区間にまとめる
      let s = 0;
      while (s < zs.length) {
        let e = s;
        while (e + 1 < zs.length && zs[e + 1] === zs[e] + 1) e++;
        out.push(`fill ${c[0] + dx} ${c[1] + dy} ${c[2] + zs[s]} ${c[0] + dx} ${c[1] + dy} ${c[2] + zs[e]} ${block}`);
        s = e + 1;
      }
    }
  return out;
}

/** 円柱（底面中心 c、半径 r、高さ h） */
export function cylinderCmds(c: Vec, r: number, h: number, block: string, hollow: boolean): string[] {
  const out: string[] = [];
  const y2 = c[1] + h - 1;
  for (let dx = -r; dx <= r; dx++) {
    const zs: number[] = [];
    for (let dz = -r; dz <= r; dz++) {
      const d = dx * dx + dz * dz;
      if (d > (r + 0.5) ** 2) continue;
      if (hollow && d <= (r - 1 + 0.5) ** 2 &&
          (dx + 1) ** 2 + dz * dz <= (r - 0.5) ** 2 && (dx - 1) ** 2 + dz * dz <= (r - 0.5) ** 2 &&
          dx * dx + (dz + 1) ** 2 <= (r - 0.5) ** 2 && dx * dx + (dz - 1) ** 2 <= (r - 0.5) ** 2) continue;
      zs.push(dz);
    }
    let s = 0;
    while (s < zs.length) {
      let e = s;
      while (e + 1 < zs.length && zs[e + 1] === zs[e] + 1) e++;
      out.push(`fill ${c[0] + dx} ${c[1]} ${c[2] + zs[s]} ${c[0] + dx} ${y2} ${c[2] + zs[e]} ${block}`);
      s = e + 1;
    }
  }
  return out;
}

/** 3D 直線（ブロックを1つずつ置く） */
export function lineCmds(a: Vec, b: Vec, block: string): string[] {
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]), 1);
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i <= n; i++) {
    const p = [0, 1, 2].map((k) => Math.round(a[k] + ((b[k] - a[k]) * i) / n));
    const key = p.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`setblock ${p[0]} ${p[1]} ${p[2]} ${block}`);
  }
  return out;
}
