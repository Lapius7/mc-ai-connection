# mc-ai-connection

[English](README.md)

Claude や Codex などの AI から、Minecraft Java 版のサーバーで建築やゲーム内の操作ができる MCP サーバーです。サーバーとは RCON でつなぐので、Mod は要りません。

```
AI クライアント ──MCP (stdio)──▶ mc-ai-connection ──RCON──▶ Minecraft サーバー
```

「Steve の隣に石レンガの塔を建てて」「原点に半径 10 のガラスのドームをかぶせて」と頼むと、AI がコマンドに変えて実行します。Minecraft 26.3 の Paper サーバーで試しており、約 700 コマンドの大聖堂も建てられました。

## 必要なもの

- [Bun](https://bun.sh) と [pnpm](https://pnpm.io)
- RCON を有効にした Minecraft Java 版のサーバー

## セットアップ

### 1. インストール

```sh
git clone https://github.com/Lapius7/mc-ai-connection
cd mc-ai-connection
pnpm install
```

### 2. サーバーで RCON を有効にする

`server.properties` に次を書き、サーバーを再起動します。

```properties
enable-rcon=true
rcon.port=25575
rcon.password=長くてランダムなパスワード
```

### 3. AI クライアントに登録する

Claude Code の場合です。

```sh
claude mcp add mc \
  -e MC_RCON_PASSWORD=長くてランダムなパスワード \
  -- bun run /絶対パス/mc-ai-connection/src/index.ts
```

Codex の場合は、`~/.codex/config.toml` に追記します。

```toml
[mcp_servers.mc]
command = "bun"
args = ["run", "/絶対パス/mc-ai-connection/src/index.ts"]
env = { MC_RCON_PASSWORD = "長くてランダムなパスワード" }
```

ほかの MCP クライアントでも、標準入出力(stdio)で `bun run src/index.ts` を起動できれば使えます。

### 4. 試す

サーバーを起動してから、AI に「オンラインのプレイヤーを教えて」「Steve はどこにいる?」と頼んでください。

## 環境変数

| 名前 | 既定値 | 内容 |
|---|---|---|
| `MC_RCON_HOST` | `127.0.0.1` | サーバーのホスト |
| `MC_RCON_PORT` | `25575` | RCON のポート |
| `MC_RCON_PASSWORD` | 空 | RCON のパスワード |
| `MC_MAX_VOLUME` | `200000` | 1回の操作で変えてよいブロック数の上限 |

## ツール

| ツール | 内容 |
|---|---|
| `run_command` | コマンドを1つ実行し、出力を返す。先頭の `/` は省略できる |
| `run_commands` | コマンドを順に最大 2000 件実行する |
| `get_player_pos` | プレイヤーの座標、向き、ディメンションを返す |
| `set_block` | ブロックを1つ置く |
| `fill` | 直方体を埋める。`mode` は `replace` `hollow` `outline` `keep` `destroy`。32768 ブロックの上限を超える範囲は自動で分割する |
| `build_sphere` | 球を作る(半径 1〜60)。空洞にもできる |
| `build_cylinder` | 円柱を作る(半径 1〜60、高さ 1〜320)。空洞にもできる |
| `build_line` | 2点の間に3次元の直線を引く |

座標は `[x, y, z]` の整数の絶対座標です。ブロックは `oak_stairs[facing=north]` のように状態も指定できます。形状ツールはすべての応答を返さず、実行数・成功数・失敗の例だけを返します。

`run_command` はサーバーのコンソールで打てるコマンドをすべて実行できます。時刻、天気、ゲームルール、エンティティの変更、アイテムの付与、テレポートなども AI に頼めます。

## AI が建てる流れ

1. `get_player_pos` で基準の座標を調べます。
2. `fill` や `build_sphere` などで形を作り、細部は `run_commands` で大量のコマンドを送ります。
3. `execute if block x y z <ブロック>` で結果を確かめます。「Test passed」か「Test failed」が返ります。

## トラブルシューティング

**`Failed to connect` と出る**

- サーバーが起動していないか、RCON が無効です。`enable-rcon=true` を設定し、再起動したか確認してください。
- ホストが違います。サーバーが Windows 側にあり、AI が WSL2 にある場合は、`127.0.0.1` で届かないことがあります。`ip route show default` で分かる Windows 側のホスト IP を `MC_RCON_HOST` に設定するか、WSL をミラーモード(`.wslconfig` に `networkingMode=mirrored`)にしてください。

**コマンドの文法エラーが出る**

コマンドの文法は Minecraft のバージョンで変わります。たとえば 26.x では `time query daytime` が使えず、`time query day` になっています。エラーを AI に読ませて再試行させるか、先に `run_command` で確認するよう頼んでください。

## 安全のために

- RCON は暗号化されず、サーバーを完全に操作できます。RCON のポートをインターネットに公開しないでください。長いパスワードとファイアウォールを使ってください。
- `run_command` では `stop` `op` `ban` などの危険なコマンドも通ります。自分のサーバーにだけつないでください。
- 元に戻す機能はありません。大きな建築の前にワールドのバックアップを取ってください。上限を超える1回の操作は `MC_MAX_VOLUME` で断ります。
- 使えるのはサーバー側のコマンドだけです。視点、移動、スクリーンショットなどのクライアント側の操作はできません。

## 開発

```sh
pnpm check   # 型チェック
pnpm start   # MCP サーバーを起動(標準入出力で待ち受ける)
```

| ファイル | 役割 |
|---|---|
| `src/rcon.ts` | 最小限の RCON クライアント |
| `src/builders.ts` | 形状をコマンド列に変える関数 |
| `src/index.ts` | MCP のツール定義 |

## 今後の予定

- 書き換える範囲を保存して元に戻す機能
- コマンドの許可リストと禁止リスト
- ユーザーが入れている Mod を返す MCP(別に作る予定)

## ライセンス

[MIT](LICENSE)
