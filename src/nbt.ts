// 最小限の NBT 読み取り（ビッグエンディアン。gzip は自動で展開）
import { gunzipSync } from "node:zlib";

export type Tag = number | bigint | string | Int8Array | Int32Array | BigInt64Array | Tag[] | { [k: string]: Tag };
export type Compound = { [k: string]: Tag };

class Reader {
  o = 0;
  constructor(private v: DataView, private b: Uint8Array) {}
  private need(n: number) { if (this.o + n > this.b.length) throw new Error("NBT が途中で切れています"); }
  u8() { this.need(1); return this.v.getUint8(this.o++); }
  i8() { this.need(1); return this.v.getInt8(this.o++); }
  i16() { this.need(2); const x = this.v.getInt16(this.o); this.o += 2; return x; }
  u16() { this.need(2); const x = this.v.getUint16(this.o); this.o += 2; return x; }
  i32() { this.need(4); const x = this.v.getInt32(this.o); this.o += 4; return x; }
  i64() { this.need(8); const x = this.v.getBigInt64(this.o); this.o += 8; return x; }
  f32() { this.need(4); const x = this.v.getFloat32(this.o); this.o += 4; return x; }
  f64() { this.need(8); const x = this.v.getFloat64(this.o); this.o += 8; return x; }
  str() { const n = this.u16(); this.need(n); const s = Buffer.from(this.b.subarray(this.o, this.o + n)).toString("utf8"); this.o += n; return s; }
  len() { const n = this.i32(); if (n < 0 || n > this.b.length) throw new Error("NBT の長さが不正です"); return n; }
}

function readTag(r: Reader, type: number, depth = 0): Tag {
  if (depth > 512) throw new Error("NBT の入れ子が深すぎます");
  switch (type) {
    case 1: return r.i8();
    case 2: return r.i16();
    case 3: return r.i32();
    case 4: return r.i64();
    case 5: return r.f32();
    case 6: return r.f64();
    case 7: { const n = r.len(); const a = new Int8Array(n); for (let i = 0; i < n; i++) a[i] = r.i8(); return a; }
    case 8: return r.str();
    case 9: {
      const t = r.u8(), n = r.len();
      if (n > 0 && t === 0) throw new Error("NBT のリストの型が不正です");
      const l: Tag[] = [];
      for (let i = 0; i < n; i++) l.push(readTag(r, t, depth + 1));
      return l;
    }
    case 10: {
      const c: Compound = {};
      for (;;) { const t = r.u8(); if (t === 0) return c; c[r.str()] = readTag(r, t, depth + 1); }
    }
    case 11: { const n = r.len(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = r.i32(); return a; }
    case 12: { const n = r.len(); const a = new BigInt64Array(n); for (let i = 0; i < n; i++) a[i] = r.i64(); return a; }
    default: throw new Error(`未知の NBT タグ ${type}`);
  }
}

/** gzip でも生でもよい。ルートの複合タグを返す */
export function parseNbt(data: Uint8Array): Compound {
  const b = data[0] === 0x1f && data[1] === 0x8b ? new Uint8Array(gunzipSync(data)) : data;
  const r = new Reader(new DataView(b.buffer, b.byteOffset, b.byteLength), b);
  if (r.u8() !== 10) throw new Error("NBT のルートが複合タグではありません");
  r.str();
  return readTag(r, 10) as Compound;
}
