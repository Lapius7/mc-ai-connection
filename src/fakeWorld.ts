// 実サーバーなしのテスト用に、fill / setblock / clone / forceload だけ真似るワールド
import type { Runner } from "./types.ts";

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const id = (b: string) => b.replace(/^minecraft:/, "");

export class FakeWorld implements Runner {
  blocks = new Map<string, string>();
  log: string[] = [];
  forced = new Set<string>();
  /** 強制ロード直後に "not loaded" を返す回数（読み込み待ちの再現） */
  notLoadedFor = 0;
  /** true の間、clone はすべて失敗する */
  failClone = false;

  get(x: number, y: number, z: number) {
    return this.blocks.get(key(x, y, z)) ?? "air";
  }
  set(x: number, y: number, z: number, b: string) {
    if (id(b) === "air") this.blocks.delete(key(x, y, z));
    else this.blocks.set(key(x, y, z), id(b));
  }

  private loaded(x: number, z: number) {
    // 退避場所（|x|,|z| が 1,000,000 以上）は強制ロードしたチャンクだけが読み込み済み
    if (Math.abs(x) < 1_000_000 && Math.abs(z) < 1_000_000) return true;
    return this.forced.has(`${x >> 4},${z >> 4}`);
  }

  async command(cmd: string): Promise<string> {
    this.log.push(cmd);
    const t = cmd.trim().split(/\s+/);
    const n = (i: number) => Number(t[i]);
    switch (t[0]) {
      case "setblock":
        this.set(n(1), n(2), n(3), t[4]!);
        return "Changed the block";
      case "fill": {
        const [x1, x2] = [Math.min(n(1), n(4)), Math.max(n(1), n(4))];
        const [y1, y2] = [Math.min(n(2), n(5)), Math.max(n(2), n(5))];
        const [z1, z2] = [Math.min(n(3), n(6)), Math.max(n(3), n(6))];
        const b = t[7]!;
        const mode = t[8] ?? "replace";
        let c = 0;
        for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) {
          const edge = x === x1 || x === x2 || y === y1 || y === y2 || z === z1 || z === z2;
          if (mode === "keep" && this.get(x, y, z) !== "air") continue;
          if (mode === "outline" && !edge) continue;
          if (mode === "hollow" && !edge) { this.set(x, y, z, "air"); c++; continue; }
          this.set(x, y, z, b);
          c++;
        }
        return c ? `Successfully filled ${c} blocks` : "No blocks were filled";
      }
      case "forceload": {
        const [x1, x2] = [Math.min(n(2), n(4)), Math.max(n(2), n(4))];
        const [z1, z2] = [Math.min(n(3), n(5)), Math.max(n(3), n(5))];
        if ((((x2 >> 4) - (x1 >> 4)) + 1) * (((z2 >> 4) - (z1 >> 4)) + 1) > 256) return "Too many chunks specified";
        for (let x = x1 >> 4; x <= x2 >> 4; x++) for (let z = z1 >> 4; z <= z2 >> 4; z++)
          t[1] === "add" ? this.forced.add(`${x},${z}`) : this.forced.delete(`${x},${z}`);
        return "Marked chunk(s) to be force loaded";
      }
      case "clone": {
        const [x1, x2] = [Math.min(n(1), n(4)), Math.max(n(1), n(4))];
        const [y1, y2] = [Math.min(n(2), n(5)), Math.max(n(2), n(5))];
        const [z1, z2] = [Math.min(n(3), n(6)), Math.max(n(3), n(6))];
        const [dx, dy, dz] = [n(7), n(8), n(9)];
        const sx = x2 - x1 + 1, sy = y2 - y1 + 1, sz = z2 - z1 + 1;
        if (sx * sy * sz > 32768) return "Too many blocks in the specified area (maximum 32768, specified 40000)";
        if (this.failClone) return "That position is not loaded";
        const corners = [[x1, z1], [x2, z2], [dx, dz], [dx + sx - 1, dz + sz - 1]] as const;
        if (corners.some(([x, z]) => !this.loaded(x, z))) {
          if (this.notLoadedFor > 0) this.notLoadedFor--;
          return "That position is not loaded";
        }
        if (this.notLoadedFor > 0) { this.notLoadedFor--; return "That position is not loaded"; }
        const mode = t[10] ?? "replace";
        const filter = mode === "filtered" ? id(t[11]!) : null;
        const copies: [number, number, number, string][] = [];
        for (let x = 0; x < sx; x++) for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) {
          const b = this.get(x1 + x, y1 + y, z1 + z);
          if (filter !== null && b !== filter) continue;
          if (mode === "masked" && b === "air") continue;
          copies.push([dx + x, dy + y, dz + z, b]);
        }
        for (const [x, y, z, b] of copies) this.set(x, y, z, b);
        return copies.length ? `Successfully cloned ${copies.length} blocks` : "No blocks were cloned";
      }
      default:
        return `Unknown or incomplete command, see below for error<--[HERE]`;
    }
  }
}
