// バージョンごとのブロック名一覧を PrismarineJS/minecraft-data から取り、差分で src/blocks.data.ts に書き出す。
// 使い方: bun scripts/gen-blocks.ts
const RAW = "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data";
const num = (v: string) => v.split(".").map(Number);
const cmp = (a: string, b: string) => {
  const x = num(a), y = num(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

const paths = (await (await fetch(`${RAW}/dataPaths.json`)).json()) as { pc: Record<string, { blocks?: string }> };
const versions = Object.keys(paths.pc)
  .filter((v) => /^\d+(\.\d+)+$/.test(v) && cmp(v, "1.16.5") >= 0 && paths.pc[v]!.blocks)
  .sort(cmp);

const names = new Map<string, string[]>();
for (const v of versions) {
  const r = await fetch(`${RAW}/${paths.pc[v]!.blocks}/blocks.json`);
  if (!r.ok) throw new Error(`${v}: ${r.status}`);
  names.set(v, ((await r.json()) as { name: string }[]).map((b) => b.name).sort());
}

// 最初の版は全部、あとの版は前の版との差分（+追加 / -削除）
let out = `// 自動生成（bun scripts/gen-blocks.ts）。手で編集しない。出典: PrismarineJS/minecraft-data\n`;
out += `export const BLOCK_DATA: { version: string; add: string[]; remove: string[] }[] = [\n`;
let prev = new Set<string>();
for (const v of versions) {
  const cur = new Set(names.get(v)!);
  const add = [...cur].filter((n) => !prev.has(n)).sort();
  const remove = [...prev].filter((n) => !cur.has(n)).sort();
  out += `  { version: "${v}", add: ${JSON.stringify(add)}, remove: ${JSON.stringify(remove)} },\n`;
  prev = cur;
}
out += `];\n`;
await Bun.write(new URL("../src/blocks.data.ts", import.meta.url), out);
console.log(`${versions.length} versions: ${versions[0]} .. ${versions.at(-1)}`);
