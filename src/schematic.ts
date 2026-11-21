// .schem（Sponge v2 / v3）と .nbt（ストラクチャー）を、貼り付け用の fill / setblock に変える
import { readFileSync } from "node:fs";
import { parseNbt, type Compound, type Tag } from "./nbt.ts";
import type { Vec } from "./builders.ts";

export type Schematic = { size: Vec; /** x + 幅*(z + 奥行*y) 番目のブロック名（空気は null） */ blocks: (string | null)[]; blockEntitiesSkipped: number };

const isObj = (t: Tag | undefined): t is Compound => !!t && typeof t === "object" && !Array.isArray(t) && !ArrayBuffer.isView(t);
const num = (t: Tag | undefined, what: string) => {
  if (typeof t !== "number") throw new Error(`${what} がありません`);
  return t;
};
const air = (n: string) => /^(minecraft:)?(cave_|void_)?air(\[.*\])?$/.test(n);
const idx = (s: Vec, x: number, y: number, z: number) => x + s[0] * (z + s[2] * y);

function varints(a: Int8Array, count: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    let v = 0, shift = 0, b: number;
    do {
      if (i >= a.length) throw new Error("BlockData が途中で切れています");
      b = a[i++]! & 0xff;
      v |= (b & 0x7f) << shift;
      shift += 7;
      if (shift > 35) throw new Error("BlockData の値が大きすぎます");
    } while (b & 0x80);
    out.push(v);
  }
  if (out.length !== count) throw new Error(`BlockData の数 ${out.length} が体積 ${count} と合いません`);
  return out;
}

function fromSponge(root: Compound): Schematic {
  const s = isObj(root.Schematic) ? root.Schematic : root; // v3 は Schematic の中
  const size: Vec = [num(s.Width, "Width"), num(s.Height, "Height"), num(s.Length, "Length")];
  const blocksTag = isObj(s.Blocks) ? s.Blocks : s; // v3 は Blocks の中に Palette と Data
  const palTag = blocksTag.Palette;
  const data = (isObj(s.Blocks) ? blocksTag.Data : s.BlockData) as Tag | undefined;
  if (!isObj(palTag) || !(data instanceof Int8Array)) throw new Error("パレットまたはブロックデータがありません");
  const pal: string[] = [];
  for (const [name, id] of Object.entries(palTag)) pal[num(id, "パレット番号")] = name;
  const vol = size[0] * size[1] * size[2];
  const ids = varints(data, vol);
  const blocks = ids.map((i) => {
    const n = pal[i];
    if (n === undefined) throw new Error(`パレットにない番号 ${i} があります`);
    return air(n) ? null : n;
  });
  const be = isObj(s.Blocks) ? blocksTag.BlockEntities : s.BlockEntities;
  return { size, blocks, blockEntitiesSkipped: Array.isArray(be) ? be.length : 0 };
}

function fromStructure(root: Compound): Schematic {
  const sz = root.size;
  if (!Array.isArray(sz) || sz.length !== 3) throw new Error("size がありません");
  const size = sz.map((v) => num(v, "size")) as Vec;
  const palette = root.palette;
  const list = root.blocks;
  if (!Array.isArray(palette) || !Array.isArray(list)) throw new Error("palette / blocks がありません");
  const names = palette.map((p) => {
    if (!isObj(p) || typeof p.Name !== "string") throw new Error("palette の形式が不正です");
    const props = isObj(p.Properties) ? Object.entries(p.Properties).map(([k, v]) => `${k}=${v}`).join(",") : "";
    return p.Name + (props ? `[${props}]` : "");
  });
  const blocks: (string | null)[] = new Array(size[0] * size[1] * size[2]).fill(null);
  let skipped = 0;
  for (const b of list) {
    if (!isObj(b) || !Array.isArray(b.pos)) throw new Error("blocks の形式が不正です");
    const [x, y, z] = b.pos.map((v) => num(v, "pos"));
    if (x! < 0 || y! < 0 || z! < 0 || x! >= size[0] || y! >= size[1] || z! >= size[2]) throw new Error("範囲外のブロックがあります");
    const n = names[num(b.state, "state")];
    if (n === undefined) throw new Error("palette にない state があります");
    if (isObj(b.nbt)) skipped++;
    blocks[idx(size, x!, y!, z!)] = air(n) || /^minecraft:(structure_void|jigsaw)/.test(n) ? null : n;
  }
  return { size, blocks, blockEntitiesSkipped: skipped };
}

export function parseSchematic(data: Uint8Array): Schematic {
  const root = parseNbt(data);
  if (root.size && root.palette) return fromStructure(root);
  if (root.Palette || root.BlockData || isObj(root.Schematic) || root.Blocks) return fromSponge(root);
  throw new Error("対応していない形式です（.schem の Sponge v2/v3 と、ストラクチャーの .nbt に対応。旧 .schematic は不可）");
}

export const loadSchematic = (path: string) => {
  if (!/\.(schem|nbt)$/i.test(path)) throw new Error("拡張子は .schem か .nbt にしてください");
  return parseSchematic(new Uint8Array(readFileSync(path)));
};

/** origin は貼り付け後の箱の最小の角。withAir なら空気も置く（貼り付け先を空にする）。x 方向に同じブロックが続く所は 1 つの fill にまとめる */
export function schematicCmds(s: Schematic, origin: Vec, withAir = false): string[] {
  const out: string[] = [];
  const [sx, sy, sz] = s.size;
  for (let y = 0; y < sy; y++)
    for (let z = 0; z < sz; z++)
      for (let x = 0; x < sx; ) {
        const b = s.blocks[idx(s.size, x, y, z)] ?? (withAir ? "air" : null);
        if (!b) { x++; continue; }
        let e = x;
        while (e + 1 < sx && (s.blocks[idx(s.size, e + 1, y, z)] ?? (withAir ? "air" : null)) === b) e++;
        const p = (xx: number) => `${origin[0] + xx} ${origin[1] + y} ${origin[2] + z}`;
        out.push(e === x ? `setblock ${p(x)} ${b}` : `fill ${p(x)} ${p(e)} ${b}`);
        x = e + 1;
      }
  return out;
}
