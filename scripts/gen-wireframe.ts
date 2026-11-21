// README 用のワイヤーフレーム調の等角3D画像を作る。
// 使い方: bun scripts/gen-wireframe.ts
//   docs/images/flow.svg と builds.svg を書き出し、rsvg-convert があれば .png も作る。
// 依存なし。ブロックを奥から手前の順に「背景色で塗った面 + 細い線」で描く。
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "images");
const BG = "#0d1117";
const LINE = "#58d6ff";
const DIM = "#2b5a6e";
const TEXT = "#c9d1d9";
const ACCENT = "#ffb454";

type P = [number, number];
const f = (n: number) => n.toFixed(1);
const pts = (a: P[]) => a.map(([x, y]) => `${f(x)},${f(y)}`).join(" ");

/** 等角投影。x は右下、z は左下、y は上へ進む。 */
function iso(s: number, ox: number, oy: number) {
  const c = Math.cos(Math.PI / 6) * s;
  const h = s / 2;
  return (x: number, y: number, z: number): P => [ox + (x - z) * c, oy + (x + z) * h - y * s];
}

type Style = { stroke: string; width: number; fill?: string };

/** ブロック1個ぶんの見える3面（上・左・右）。 */
function voxel(p: ReturnType<typeof iso>, x: number, y: number, z: number, st: Style): string {
  const fill = st.fill ?? BG;
  const a = (dx: number, dy: number, dz: number) => p(x + dx, y + dy, z + dz);
  const faces = [
    [a(0, 1, 0), a(1, 1, 0), a(1, 1, 1), a(0, 1, 1)], // 上
    [a(0, 0, 1), a(1, 0, 1), a(1, 1, 1), a(0, 1, 1)], // 左（+z）
    [a(1, 0, 0), a(1, 0, 1), a(1, 1, 1), a(1, 1, 0)], // 右（+x）
  ];
  return faces
    .map((q) => `<polygon points="${pts(q)}" fill="${fill}" stroke="${st.stroke}" stroke-width="${st.width}" stroke-linejoin="round"/>`)
    .join("");
}

function voxels(p: ReturnType<typeof iso>, cells: [number, number, number][], st: Style): string {
  return [...cells]
    .sort((u, v) => u[0] + u[1] + u[2] - (v[0] + v[1] + v[2]) || u[1] - v[1])
    .map(([x, y, z]) => voxel(p, x, y, z, st))
    .join("");
}

/** 地面の格子線。 */
function floor(p: ReturnType<typeof iso>, x0: number, z0: number, x1: number, z1: number, y = 0): string {
  let s = "";
  for (let x = x0; x <= x1; x++) s += `<line x1="${f(p(x, y, z0)[0])}" y1="${f(p(x, y, z0)[1])}" x2="${f(p(x, y, z1)[0])}" y2="${f(p(x, y, z1)[1])}"/>`;
  for (let z = z0; z <= z1; z++) s += `<line x1="${f(p(x0, y, z)[0])}" y1="${f(p(x0, y, z)[1])}" x2="${f(p(x1, y, z)[0])}" y2="${f(p(x1, y, z)[1])}"/>`;
  return `<g stroke="${DIM}" stroke-width="1" opacity="0.8">${s}</g>`;
}

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="DejaVu Sans, Noto Sans, Helvetica, Arial, sans-serif">
<rect width="${w}" height="${h}" fill="${BG}"/>
${body}
</svg>
`;
}

const label = (x: number, y: number, t: string, sub?: string) =>
  `<text x="${f(x)}" y="${f(y)}" fill="${TEXT}" font-size="30" font-weight="600" text-anchor="middle">${t}</text>` +
  (sub ? `<text x="${f(x)}" y="${f(y + 30)}" fill="${DIM}" font-size="20" text-anchor="middle" style="fill:#7aa6b8">${sub}</text>` : "");

const solid = (n: number): [number, number, number][] => {
  const c: [number, number, number][] = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) c.push([x, y, z]);
  return c;
};
const hollowCube = (n: number): [number, number, number][] => solid(n).filter(([x, y, z]) => x === 0 || y === 0 || z === 0 || x === n - 1 || y === n - 1 || z === n - 1);

/** 1枚目: AI → MCP → RCON → Minecraft サーバー */
function flow(): string {
  const W = 1600, H = 420, cy = 170, s = 30;
  const xs = [190, 590, 990, 1390];
  const cubes: string[] = [];
  const sizes = [2, 3, 2, 0];
  xs.forEach((cx, i) => {
    const n = sizes[i];
    if (i < 3) {
      // 中心が cx, cy になるようにずらす
      const p = iso(s, cx, cy + (n * s * 0.5));
      cubes.push(voxels(p, hollowCube(n), { stroke: LINE, width: 2 }));
    }
  });
  // サーバー: 地面の上のミニ建築（塔とピラミッド）
  const sp = iso(s * 0.7, xs[3] - 10, cy + 40);
  const world: [number, number, number][] = [];
  for (let y = 0; y < 5; y++) world.push([0, y, 0]);
  for (let y = 0; y < 3; y++) for (let x = 2; x < 5 - y; x++) for (let z = 1; z < 4 - y; z++) world.push([x, y, z]);
  const server = floor(sp, -1, -1, 6, 5) + voxels(sp, world, { stroke: LINE, width: 2 });
  // 矢印（点線）
  const arrows = [0, 1, 2]
    .map((i) => {
      const x1 = xs[i] + 105, x2 = xs[i + 1] - 125, y = cy + 10;
      return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${ACCENT}" stroke-width="2.5" stroke-dasharray="10 8"/>` +
        `<polygon points="${x2 + 14},${y} ${x2 - 2},${y - 8} ${x2 - 2},${y + 8}" fill="${ACCENT}"/>`;
    })
    .join("");
  const edgeLabels = ["stdio", "commands", "TCP 25575"]
    .map((t, i) => `<text x="${(xs[i] + xs[i + 1]) / 2 - 10}" y="${cy - 14}" fill="${ACCENT}" font-size="18" text-anchor="middle">${t}</text>`)
    .join("");
  const labels =
    label(xs[0], 365, "AI client", "Claude, Codex, ...") +
    label(xs[1], 365, "MCP server", "mc-ai-connection") +
    label(xs[2], 365, "RCON", "unencrypted, keep it private") +
    label(xs[3], 365, "Minecraft server", "Java Edition");
  return svg(W, H, cubes.join("") + arrows + edgeLabels + server + labels);
}

/** 2枚目: ブロックで建てた塔とピラミッド */
function builds(): string {
  const W = 1600, H = 680, s = 22;
  const p = iso(s, 800, 400);
  // 塔（円柱に近い角柱 + 見張り台）
  const tower: [number, number, number][] = [];
  for (let y = 0; y < 11; y++) for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) {
    const edge = x !== 1 || z !== 1;
    if (edge || y < 1) tower.push([x - 7, y, z - 1]);
  }
  for (let x = -1; x < 4; x++) for (let z = -1; z < 4; z++) {
    if (x === -1 || z === -1 || x === 3 || z === 3 || (x + z) % 2 === 0) tower.push([x - 7, 11, z - 1]);
  }
  // ピラミッド（階段状）
  const pyr: [number, number, number][] = [];
  const n = 9;
  for (let y = 0; y < 5; y++) for (let x = y; x < n - y; x++) for (let z = y; z < n - y; z++) {
    const wall = x === y || z === y || x === n - y - 1 || z === n - y - 1;
    if (wall) pyr.push([x + 1, y, z - 4]);
  }
  pyr.push([5, 5, 0]);
  const g = floor(p, -10, -6, 10, 7);
  const body = g + voxels(p, tower, { stroke: LINE, width: 1.6 }) + voxels(p, pyr, { stroke: LINE, width: 1.6 });
  const note = label(480, 630, "Tower", "fill / build_cylinder") + label(1120, 630, "Pyramid", "build_pyramid");
  return svg(W, H, body + note);
}

mkdirSync(OUT, { recursive: true });
for (const [name, content] of [["flow", flow()], ["builds", builds()]] as const) {
  const path = join(OUT, `${name}.svg`);
  writeFileSync(path, content);
  const r = Bun.spawnSync(["rsvg-convert", "-w", "1600", "-o", join(OUT, `${name}.png`), path]);
  console.log(name, r.exitCode === 0 ? "svg+png" : "svg only (rsvg-convert unavailable)");
}
