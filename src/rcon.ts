// 最小限の RCON クライアント（Source RCON プロトコル）
type Pending = { resolve: (b: string) => void; reject: (e: Error) => void };

export class Rcon {
  private socket: Awaited<ReturnType<typeof Bun.connect>> | null = null;
  private buf = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private host: string,
    private port: number,
    private password: string,
  ) {}

  private packet(id: number, type: number, body: string) {
    const b = Buffer.from(body, "utf8");
    const out = Buffer.alloc(14 + b.length);
    out.writeInt32LE(10 + b.length, 0);
    out.writeInt32LE(id, 4);
    out.writeInt32LE(type, 8);
    b.copy(out, 12);
    return out;
  }

  private onData(data: Buffer) {
    this.buf = Buffer.concat([this.buf, data]);
    while (this.buf.length >= 4) {
      const len = this.buf.readInt32LE(0);
      if (this.buf.length < 4 + len) break;
      const id = this.buf.readInt32LE(4);
      const body = this.buf.subarray(12, 4 + len - 2).toString("utf8");
      this.buf = this.buf.subarray(4 + len);
      const p = this.pending.get(id === -1 ? 0 : id);
      if (id === -1) {
        this.pending.get(0)?.reject(new Error("RCON パスワードが違います"));
        this.pending.delete(0);
      } else if (p) {
        this.pending.delete(id);
        p.resolve(body);
      }
    }
  }

  private send(type: number, body: string, authId?: number): Promise<string> {
    const id = authId ?? this.nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("RCON タイムアウト"));
      }, 10000);
      this.pending.set(id, {
        resolve: (b) => (clearTimeout(t), resolve(b)),
        reject: (e) => (clearTimeout(t), reject(e)),
      });
      this.socket!.write(this.packet(id, type, body));
    });
  }

  private async connect() {
    this.buf = Buffer.alloc(0);
    this.socket = await Bun.connect({
      hostname: this.host,
      port: this.port,
      socket: {
        data: (_s, d) => this.onData(Buffer.from(d)),
        close: () => { this.socket = null; },
        error: () => { this.socket = null; },
      },
    });
    // 認証失敗は id=-1 で返るので、待ち受け用に 0 を使う
    await this.send(3, this.password, 0).catch((e) => {
      this.socket?.end();
      this.socket = null;
      throw e;
    });
  }

  /** コマンドを1つずつ順番に実行する */
  command(cmd: string): Promise<string> {
    const run = async () => {
      if (!this.socket) await this.connect();
      return this.send(2, cmd.replace(/^\//, ""));
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}
