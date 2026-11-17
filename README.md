# mc-ai-connection

Claude や Codex などの AI から、Minecraft のサーバーに建築やコマンド操作をさせる MCP サーバーです。サーバーの RCON に接続して、コマンドを送ります。Mod は要りません。

## 必要なもの

- Bun
- pnpm
- RCON を有効にした Minecraft Java 版のサーバー

## セットアップ

### 1. 依存を入れる

```sh
pnpm install
```

### 2. サーバーで RCON を有効にする

`server.properties` に次を書き、サーバーを再起動します。

```properties
enable-rcon=true
rcon.port=25575
rcon.password=好きなパスワード
```

RCON ではサーバーのコマンドをすべて実行できます。RCON のポートはインターネットに公開しないでください。同じ PC か、信頼できるネットワークの中だけで使います。

### 3. AI に登録する

Claude Code の場合です。

```sh
claude mcp add mc \
  -e MC_RCON_PASSWORD=好きなパスワード \
  -- bun run /絶対パス/mc-ai-connection/src/index.ts
```

Codex の場合は、`~/.codex/config.toml` に追記します。

```toml
[mcp_servers.mc]
command = "bun"
args = ["run", "/絶対パス/mc-ai-connection/src/index.ts"]
env = { MC_RCON_PASSWORD = "好きなパスワード" }
```

ほかの MCP 対応クライアントでも、標準入出力(stdio)で `bun run src/index.ts` を起動する設定にすれば使えます。

## 環境変数

| 名前 | 既定値 | 内容 |
|---|---|---|
| `MC_RCON_HOST` | `127.0.0.1` | サーバーのホスト |
| `MC_RCON_PORT` | `25575` | RCON のポート |
| `MC_RCON_PASSWORD` | 空 | RCON のパスワード |
| `MC_MAX_VOLUME` | `200000` | 1回の操作で変えてよいブロック数の上限 |

## 使い方

AI に頼むだけです。AI はまず `get_player_pos` で基準の座標を調べてから建てます。

- 「プレイヤー Steve の今いる場所の隣に、石レンガの塔を建てて」
- 「原点に半径 10 のガラスのドームをかぶせて」
- 「この2点の間に、オークの橋をかけて」
- 「夜にして、雨も止めて」

## ツール

| ツール | 内容 |
|---|---|
| `run_command` | コマンドを1つ実行し、結果を返す。先頭の `/` は不要 |
| `run_commands` | コマンドをまとめて実行する。最大 2000 件 |
| `get_player_pos` | プレイヤーの座標、向き、ディメンションを返す |
| `set_block` | ブロックを1つ置く |
| `fill` | 直方体を埋める。`mode` は `replace` `hollow` `outline` `keep` `destroy`。大きい範囲は自動で分割する |
| `build_sphere` | 球を作る。半径は 1〜60。`hollow` で空洞にする |
| `build_cylinder` | 円柱を作る。半径は 1〜60、高さは 1〜320。`hollow` で空洞にする |
| `build_line` | 2点の間に直線を引く |

座標はすべて整数の絶対座標で、`[x, y, z]` の形で渡します。ブロックは `stone` や `oak_stairs[facing=north]` のように、ブロックの状態も含めて書けます。

ツールの結果は実行した件数、成功した件数、失敗の例だけを返します。

## 制限と注意

- `undo`(元に戻す)はありません。大きな建築の前に、ワールドのバックアップを取ってください。
- 1回の体積が `MC_MAX_VOLUME` を超える操作は、実行せずに断ります。
- `run_command` では `stop` や `ban` などの危険なコマンドも通ります。接続先は自分のサーバーだけにしてください。
- 実行できるのはサーバー側のコマンドだけです。プレイヤーの視点や移動、スクリーンショットなど、クライアント側の操作はできません。
- 偽の RCON サーバーとの疎通は確かめましたが、Minecraft 26.3 の実機ではまだ試していません。

## 開発

```sh
pnpm check   # 型チェック
pnpm start   # MCP サーバーを起動(標準入出力で待ち受ける)
```

- `src/rcon.ts` は RCON クライアントです。
- `src/builders.ts` は、形状をコマンド列に変える関数です。
- `src/index.ts` は MCP のツール定義です。
