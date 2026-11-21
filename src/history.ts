// 書き換え前のブロックを、ワールドの奥の保管場所へ clone で退避し、後から戻せるようにする。
// 退避は clone なので、チェストの中身などブロックエンティティも含めて元どおりに戻る。
// 戻せるのは「直前の操作から順番に」だけ（古い履歴だけ戻すと、後の操作と食い違うため）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Box, Vec } from "./builders.ts";
import type { Runner } from "./types.ts";
import { cloneCount, forceload, sleep, type SleepFn } from "./world.ts";

export type Slot = { src: Box; dest: Vec };
export type Entry = {
  id: number;
  time: string;
  server: string;
  tool: string;
  summary: string;
  blocks: number;
  slots: Slot[];
};
type State = { next: number; zCursor: number; entries: Entry[] };

export type HistoryOpts = {
  dir: string;
  server: string;
  origin: [number, number];
  limit: number;
  wait?: SleepFn;
};

const align16 = (n: number) => Math.ceil(n / 16) * 16;
const MAX_Z_SPAN = 800_000;

export class History {
  private ox: number;
  private oz: number;
  private file: string;
  private state: State | null = null;
  private wait: SleepFn;

  constructor(private o: HistoryOpts) {
    this.ox = Math.floor(o.origin[0] / 16) * 16;
    this.oz = Math.floor(o.origin[1] / 16) * 16;
    this.file = join(o.dir, `undo-${o.server.replace(/[^\w.-]/g, "_")}.json`);
    this.wait = o.wait ?? sleep;
  }

  private load(): State {
    if (this.state) return this.state;
    this.state = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as State)
      : { next: 1, zCursor: 0, entries: [] };
    return this.state;
  }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.state));
  }

  /** 新しい順 */
  list(): Entry[] {
    return [...this.load().entries].reverse();
  }

  /** 範囲を退避して履歴に積む。退避に失敗したら、何も積まずに例外（書き換えは始めない） */
  async begin(raw: Runner, meta: { tool: string; summary: string; blocks: number }, boxes: Box[]): Promise<Entry> {
    const st = this.load();
    if (st.entries.length === 0) st.zCursor = 0;
    let cursor = st.zCursor;
    const slots: Slot[] = boxes.map((src) => {
      const dest: Vec = [this.ox, src.lo[1], this.oz + cursor];
      cursor += align16(src.hi[2] - src.lo[2] + 1);
      return { src, dest };
    });
    if (cursor > MAX_Z_SPAN)
      throw new Error("バックアップ置き場がいっぱいです。undo で履歴を戻すか、古い履歴の自動削除を待ってください");

    const done: Slot[] = [];
    try {
      for (const s of slots) {
        await forceload(raw, "add", s.dest, this.destHi(s));
        done.push(s);
        const n = await cloneCount(raw, s.src.lo, s.src.hi, s.dest, "replace", this.wait);
        if (n === 0) throw new Error(`バックアップが 0 ブロックでした: ${s.src.lo.join(" ")}`);
      }
    } catch (e) {
      await Promise.all(done.map((s) => this.release(raw, s)));
      throw new Error(`元のブロックを退避できなかったため、何も書き換えていません。${e instanceof Error ? e.message : e}`);
    }

    const entry: Entry = {
      id: st.next++, time: new Date().toISOString(), server: this.o.server, ...meta, slots,
    };
    st.zCursor = cursor;
    st.entries.push(entry);
    const evicted = st.entries.length > this.o.limit ? st.entries.splice(0, st.entries.length - this.o.limit) : [];
    this.save();
    for (const old of evicted) for (const s of old.slots) await this.release(raw, s);
    return entry;
  }

  private destHi(s: Slot): Vec {
    const sz = (i: number) => s.src.hi[i]! - s.src.lo[i]!;
    return [s.dest[0] + sz(0), s.dest[1] + sz(1), s.dest[2] + sz(2)];
  }

  /** 退避先を空にして強制ロードを外す。失敗しても履歴には影響させない */
  private async release(raw: Runner, s: Slot) {
    const h = this.destHi(s);
    try {
      await raw.command(`fill ${s.dest.join(" ")} ${h.join(" ")} air`);
      await forceload(raw, "remove", s.dest, h);
    } catch { /* 後始末の失敗は無視 */ }
  }

  /** 直前の操作から steps 件を戻す。途中で失敗したら、そこで止めて失敗した履歴は残す */
  async undo(raw: Runner, steps = 1): Promise<{ restored: Entry[]; error?: string }> {
    const st = this.load();
    const restored: Entry[] = [];
    for (let i = 0; i < steps && st.entries.length > 0; i++) {
      const e = st.entries[st.entries.length - 1]!;
      try {
        for (const s of [...e.slots].reverse()) {
          await forceload(raw, "add", s.dest, this.destHi(s));
          await cloneCount(raw, s.dest, this.destHi(s), s.src.lo, "replace", this.wait);
        }
      } catch (err) {
        return { restored, error: `#${e.id} を戻せませんでした（履歴は残してあります）: ${err instanceof Error ? err.message : err}` };
      }
      st.entries.pop();
      this.save();
      for (const s of e.slots) await this.release(raw, s);
      restored.push(e);
    }
    return { restored };
  }
}

export const entryLine = (e: Entry) =>
  `#${e.id}  ${e.time.replace("T", " ").slice(0, 19)}  ${e.tool}  ${e.summary}  (${e.blocks} ブロック)`;
