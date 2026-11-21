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

## 複数のサーバー

`~/.config/mc-ai-connection/servers.json` に複数のサーバーを登録できます(場所は `MC_SERVERS_FILE` で変えられます)。書き方は [`servers.example.json`](servers.example.json) を見てください。パスワードが入るので、ファイルは自分だけが読めるようにします(`chmod 600`)。

| 項目 | 内容 |
|---|---|
| `host`, `port` | RCON のアドレス。`ssh` を指定したときは、SSH 先から見たアドレス |
| `password` / `passwordEnv` | パスワード、またはパスワードを入れた環境変数の名前 |
| `ssh` | 任意。`~/.ssh/config` のホスト名。MCP がトンネルを張るので、RCON のポートを公開しなくて済みます |
| `version` | 任意。Minecraft のバージョン(例 `1.21.4` `26.1`)。ブロック名と高さの検査、名前の読み替えが有効になります(下の「バージョン」を参照)。環境変数だけで1台使う場合は `MC_VERSION` |
| `description` | `list_servers` に出る説明 |
| `default`(最上位) | 呼び出しに `server` がないときに使うサーバー |

どのツールにも、任意の `server` 引数があります。`list_servers` で登録済みのサーバーを確認でき、`use_server` で既定のサーバーを切り替えられます(MCP を再起動するまで有効)。設定ファイルがなければ、これまでどおり次の `MC_RCON_*` で `default` という1台だけを登録した扱いになります。設定ファイルがあるときは、`MC_RCON_*` は使われません。

## 環境変数

| 名前 | 既定値 | 内容 |
|---|---|---|
| `MC_RCON_HOST` | `127.0.0.1` | サーバーのホスト |
| `MC_RCON_PORT` | `25575` | RCON のポート |
| `MC_RCON_PASSWORD` | 空 | RCON のパスワード |
| `MC_MAX_PALETTE_BLOCKS` | `30000` | パレットで混ぜられる、1回の操作のブロック数の上限 |
| `MC_MAX_COPY_COLUMNS` | `10000` | `copy_region` で1回に回転・反転できる柱の数の上限 |
| `MC_MAX_VOLUME` | `200000` | 1回の操作で変えてよいブロック数の上限 |

## 設定ファイル

動作の設定は `~/.config/mc-ai-connection/config.json` に書きます(場所は `MC_CONFIG_FILE` で変えられます)。書き方は [`config.example.json`](config.example.json) を見てください。項目はすべて省略できます。

| 項目 | 既定値 | 内容 |
|---|---|---|
| `commands.deny` | `stop` `op` `deop` `ban` `ban-ip` `pardon` `pardon-ip` | 拒否するコマンド。単語の前方一致なので `"time set"` のようにも書けます。`[]` にすると何も拒否しません |
| `commands.allow` | `[]` | 空でなければ、前方一致したコマンドだけ実行します。`deny` が `allow` より優先されます |
| `log.enabled` | `true` | 操作ログを書く |
| `log.file` | `MC_STATE_DIR` の `operations.jsonl` | ログの保存先 |
| `undo.enabled` | `true` | 書き込む前に元のブロックを保存し、`undo` で戻せるようにする |
| `undo.limit` | `20` | サーバーごとに残す履歴の件数。超えた古いものは捨てます |
| `undo.origin` | `[29000000, 29000000]` | バックアップ置き場の `[x, z]`(「元に戻す」を参照)。ワールドボーダーの内側にしてください |
| `undo.maxVolume` | `2000000` | 1回の操作でバックアップできる最大のブロック数 |

リストが効くのは、利用者や AI が頼んだコマンドです。`run_command`、`run_commands`、`fill` や `build_*` が作るコマンドが対象で、`execute ... run <コマンド>` の `run` 以降も含みます。MCP が内部で使うコマンド(undo と `inspect_region` の `clone` と `forceload`、`get_player_pos` の `data get`)は検査しません。そのため `clone` を禁止しても undo は壊れません。履歴は `MC_STATE_DIR`(既定は `~/.local/state/mc-ai-connection`)に保存します。

## ツール

| ツール | 内容 |
|---|---|
| `list_servers` | 登録済みのサーバーと、現在の既定を一覧する |
| `use_server` | 既定のサーバーを切り替える |
| `run_command` | コマンドを1つ実行し、出力を返す。先頭の `/` は省略できる |
| `run_commands` | コマンドを順に最大 2000 件実行する |
| `get_player_pos` | プレイヤーの座標、向き、ディメンションを返す |
| `set_block` | ブロックを1つ置く |
| `fill` | 直方体を埋める。`mode` は `replace` `hollow` `outline` `keep` `destroy`。32768 ブロックの上限を超える範囲は自動で分割する |
| `build_sphere` | 球を作る(半径 1〜60)。空洞にもできる |
| `build_cylinder` | 円柱を作る(半径 1〜60、高さ 1〜320)。空洞にもできる |
| `build_line` | 2点の間に3次元の直線を引く |
| `build_pyramid` | 四角錐(中を空けることもできる) |
| `build_arch` | 半円のアーチ(脚の高さ・厚み・奥行きを指定) |
| `build_spiral_stairs` | らせん階段(中心の柱は任意。1段ごとに1ブロック上がる) |
| `build_roof` | 切妻または寄棟の屋根。`stairBlock` を渡すと切妻の傾斜を向きつきの階段で作る |
| `copy_region` | 範囲を別の場所へコピー(90 度刻みの回転と x / z 反転つき。サーバー側の `clone` で、ブロックの向きは回転しない) |
| `paste_schematic` | `.schem`(Sponge v2/v3)またはストラクチャーの `.nbt` を指定の座標に貼る(チェストの中身などブロックエンティティの NBT は貼らない) |
| `build_walls` | 四方の壁に、等間隔の窓と出入口の開口(空気。ドアのブロックは置かない)をまとめて作る |
| `undo` | 直前の書き込みを元に戻す(`steps` で件数を指定)。新しい順にだけ戻せる |
| `list_history` | `undo` で戻せる書き込みを、サーバーごとに一覧する |
| `operation_log` | 直近の操作ログを返す(実行、ドライラン、拒否、失敗、undo) |
| `inspect_region` | 範囲内のブロックを種類ごとに数える(読み取りのみ) |

`set_block` `fill` `build_*` には `dryRun: true` を渡せます。何も実行せず、コマンド数、変わりうる最大のブロック数、範囲だけを返します。

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

## バージョン

サーバーに `version` を書くと、書き込み系のツール(`set_block` `fill` `build_*` `copy_region` `paste_schematic`)が、何かを書く前にコマンドを検査します。ドライランでも同じ結果が出ます。

- **ブロック名**: そのバージョンにない名前は、「もしかして」つきで断ります。一覧は [minecraft-data](https://github.com/PrismarineJS/minecraft-data) の 1.16.5〜26.1 から作っています(`bun scripts/gen-blocks.ts` で `src/blocks.data.ts` を作り直せます)。一覧にない中間のバージョン(1.21.2 など)は、前後どちらかにある名前を通します。一覧より古い・新しいバージョンは検査せず、その旨を添えます。ほかの名前空間の名前と `#タグ` は検査しません。
- **名前が変わったブロック**は、そのバージョンの名前に読み替えます: `grass_path`/`dirt_path`(1.17)、`grass`/`short_grass`(1.20.3)、`chain`/`iron_chain`(1.21.9)。どちらの向きにも読み替えます。
- **高さ**: 1.18 より前は 0〜255、1.18 以降は -64〜319。

`run_command` と `run_commands` は読み替えず、書いたとおりに送ります。`version` がなければ何も検査しません。バージョンはサーバーから取りません(RCON に標準のコマンドがないため)。

## 進捗通知

時間のかかる操作(書き込み系のツールと `run_commands`)では、コマンドの実行中に MCP の `notifications/progress` を送ります。間隔はおよそ全体の 5% ごと、または 1 秒ごとです。呼び出しに `progressToken` を付けるクライアントだけが受け取ります。付けないクライアントには影響しません。数えるのはブロック数ではなくコマンド数です。書き込み前の退避の間は、進捗を送りません。

## ブロックパレット

`block` を取るツール(`set_block` `fill` `build_sphere` `build_cylinder` `build_line`)には、名前のかわりに配列を渡すと、割合でブロックを混ぜられます。

```json
{ "block": [{ "block": "stone_bricks", "weight": 70 }, { "block": "mossy_stone_bricks", "weight": 30 }], "seed": 1 }
```

`weight` は相対値で、合計が 100 でなくても構いません。`seed` が同じなら同じ並びになるので、ドライランと本番で結果が揃います。パレットは1ブロックずつ置くため(同じブロックが続く所は1つの `fill` にまとめます)、`MC_MAX_PALETTE_BLOCKS` で件数を制限しています。`fill` の `mode` は `replace` `hollow` `outline` が使えます。

## 操作ログ

コマンドを実行した、または拒否した呼び出しは、すべて `operations.jsonl` に追記します(1行に1件の JSON。時刻、サーバー、ツール、結果、要約、コマンド数)。既定では `MC_STATE_DIR` の中で、元に戻す履歴と同じ場所にあります。各行に履歴の ID(`historyId`)が入るので、ログの行と `undo` の履歴を突き合わせられます。5 MB を超えると `operations.jsonl.1` に回します。

## 元に戻す

`set_block` `fill` `build_*` が書き込む前に、MCP は範囲を `/clone` でバックアップ置き場へ複製します。ブロックの状態や、チェストの中身のようなブロックエンティティも、そのまま戻ります。置き場はスポーンから遠い場所(`undo.origin`)にあり、履歴が残っている間だけチャンクを強制ロードします。`undo` は複製を元の場所へ戻し、置き場を空にします。

- 履歴はサーバーごと、操作ごとです。戻せるのは新しい順だけです。古い履歴だけを戻すと、あとの操作と食い違ってワールドが壊れるためです。
- バックアップに失敗したときは、何も書き込みません。戻すのに失敗したときは、やり直せるよう履歴を残します。
- `/clone` は読み込み済みのチャンクにしか使えないため、範囲は読み込まれている必要があります。操作は RCON が使うディメンション(オーバーワールド)で行われます。
- `run_command` と `run_commands` は**対象外**です。任意のコマンドが何を変えるかは MCP には分からないためです。あとで戻したい部分は `fill` や `build_*` で作ってください。
- エンティティ(モブやドロップアイテム)は保存しません。

## 安全のために

- RCON は暗号化されず、サーバーを完全に操作できます。RCON のポートをインターネットに公開しないでください。長いパスワードとファイアウォールを使ってください。
- `stop` `op` `ban` などのコマンドは、既定で拒否します(設定ファイルを参照)。自分のサーバーにだけつないでください。AI にさせたくないことが多いなら、`commands.allow` で絞ります。
- `undo` で戻せるのは `set_block` `fill` `build_*` だけです。大きな建築の前と、`run_command` で行う操作の前には、ワールドのバックアップを取ってください。上限を超える1回の操作は `MC_MAX_VOLUME` で断ります。
- 使えるのはサーバー側のコマンドだけです。視点、移動、スクリーンショットなどのクライアント側の操作はできません。

## 開発

```sh
pnpm check   # 型チェックと単体テスト(サーバーは不要)
pnpm test    # 単体テストだけ
pnpm start   # MCP サーバーを起動(標準入出力で待ち受ける)
```

| ファイル | 役割 |
|---|---|
| `src/rcon.ts` | 最小限の RCON クライアント |
| `src/servers.ts` | サーバーの登録、設定ファイル、SSH トンネル |
| `src/builders.ts` | 形状をコマンド列に変える関数 |
| `src/policy.ts` | コマンドの許可リストと禁止リスト |
| `src/plan.ts` | コマンド列が書き換えるブロックの範囲を求める |
| `src/history.ts` | 書き込み前のバックアップと、元に戻す処理 |
| `src/ops.ts` | 書き込みの共通の流れ(リスト判定、ドライラン、バックアップ、実行) |
| `src/palette.ts` | 割合でブロックを混ぜる |
| `src/copy.ts` | 回転・反転つきのコピーを `clone` に変える |
| `src/nbt.ts` `src/schematic.ts` | `.schem` / `.nbt` を `fill` / `setblock` に変える |
| `src/versions.ts` `src/validate.ts` | バージョンごとのブロック名・名前の変更・高さの検査 |
| `src/shapes.ts` | ピラミッド・アーチ・らせん階段・屋根・窓つきの壁 |
| `src/oplog.ts` | 操作ログのファイル |
| `src/inspect.ts` | 範囲内のブロックの集計 |
| `src/config.ts` | 設定ファイル |
| `src/index.ts` | MCP のツール定義 |

## 今後の予定

- `run_command` で送るコマンドの、バージョンによる文法の違いの吸収(書き込み系のツールは、ブロック名・名前の変更・高さまで対応済み)
- ユーザーが入れている Mod を返す MCP(別に作る予定)

## ライセンス

[MIT](LICENSE)
