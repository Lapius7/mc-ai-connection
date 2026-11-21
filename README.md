# mc-ai-connection

[日本語](README.ja.md)

An MCP server that lets AI assistants (Claude, Codex, and any other MCP client) build and operate on a Minecraft Java server. It talks to the server over RCON, so no mod is required.

```
AI client ──MCP (stdio)──▶ mc-ai-connection ──RCON──▶ Minecraft server
```

Ask for "a stone-brick tower next to Steve" or "a glass dome of radius 10 at the origin", and the AI turns it into commands. It has been tried on a Paper server running Minecraft 26.3, including a full cathedral build of about 700 commands.

## Requirements

- [Bun](https://bun.sh) and [pnpm](https://pnpm.io)
- A Minecraft Java server with RCON enabled

## Setup

### 1. Install

```sh
git clone https://github.com/Lapius7/mc-ai-connection
cd mc-ai-connection
pnpm install
```

### 2. Enable RCON on the server

Add this to `server.properties` and restart the server.

```properties
enable-rcon=true
rcon.port=25575
rcon.password=use-a-long-random-password
```

### 3. Register it with your AI client

Claude Code:

```sh
claude mcp add mc \
  -e MC_RCON_PASSWORD=use-a-long-random-password \
  -- bun run /absolute/path/to/mc-ai-connection/src/index.ts
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.mc]
command = "bun"
args = ["run", "/absolute/path/to/mc-ai-connection/src/index.ts"]
env = { MC_RCON_PASSWORD = "use-a-long-random-password" }
```

Any other MCP client works if it can launch `bun run src/index.ts` over stdio.

### 4. Try it

Start the server, then ask the AI: "List the online players" or "Where is Steve standing?".

## Multiple servers

Register several servers in `~/.config/mc-ai-connection/servers.json` (override the path with `MC_SERVERS_FILE`). See [`servers.example.json`](servers.example.json). Keep the file private (`chmod 600`).

| Field | Description |
|---|---|
| `host`, `port` | RCON address. With `ssh`, this is seen from the SSH host |
| `password` / `passwordEnv` | The password, or the name of an environment variable that holds it |
| `ssh` | Optional. An SSH host from `~/.ssh/config`. The MCP opens a tunnel, so the RCON port never has to be exposed |
| `description` | Free text shown by `list_servers` |
| `default` (top level) | The server used when a call has no `server` |

Every tool takes an optional `server` argument. `list_servers` shows what is registered, and `use_server` changes the default until the MCP restarts. Without the file, the `MC_RCON_*` variables below define a single server named `default`, as before. With the file, they are ignored.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MC_RCON_HOST` | `127.0.0.1` | Server host |
| `MC_RCON_PORT` | `25575` | RCON port |
| `MC_RCON_PASSWORD` | empty | RCON password |
| `MC_MAX_VOLUME` | `200000` | Maximum number of blocks one operation may change |

## Settings file

Behavior settings live in `~/.config/mc-ai-connection/config.json` (override the path with `MC_CONFIG_FILE`). See [`config.example.json`](config.example.json). Every field is optional.

| Field | Default | Description |
|---|---|---|
| `commands.deny` | `stop`, `op`, `deop`, `ban`, `ban-ip`, `pardon`, `pardon-ip` | Commands that are refused. Matched by prefix on words, so `"time set"` works. Set `[]` to allow everything |
| `commands.allow` | `[]` | If not empty, only commands matching an entry run. `deny` wins over `allow` |
| `undo.enabled` | `true` | Save original blocks before each write so it can be undone |
| `undo.limit` | `20` | History entries kept per server. Older ones are dropped |
| `undo.origin` | `[29000000, 29000000]` | `[x, z]` of the backup area (see Undo). Keep it inside the world border |
| `undo.maxVolume` | `2000000` | Largest number of blocks one operation may back up |

The lists apply to the commands you or the AI ask for: `run_command`, `run_commands`, and the ones that `fill` and `build_*` generate, including the command after `run` in `execute ... run <command>`. The MCP's own internal commands (the `clone` and `forceload` that undo and `inspect_region` use, and the `data get` behind `get_player_pos`) are not checked, so a deny rule on `clone` does not break undo. The history lives in `MC_STATE_DIR` (default `~/.local/state/mc-ai-connection`).

## Tools

| Tool | Description |
|---|---|
| `list_servers` | List the registered servers and the current default |
| `use_server` | Change the default server |
| `run_command` | Run one command and return its output. A leading `/` is optional |
| `run_commands` | Run up to 2000 commands in order |
| `get_player_pos` | Get a player's position, rotation, and dimension |
| `set_block` | Place one block |
| `fill` | Fill a box. `mode` is `replace`, `hollow`, `outline`, `keep`, or `destroy`. Large boxes are split automatically to stay under the 32768-block limit |
| `build_sphere` | Build a sphere (radius 1 to 60), optionally hollow |
| `build_cylinder` | Build a cylinder (radius 1 to 60, height 1 to 320), optionally hollow |
| `build_line` | Draw a 3D line between two points |
| `undo` | Undo the latest writes (`steps` = how many). Newest first only |
| `list_history` | List the writes `undo` can restore, per server |
| `inspect_region` | Count blocks by type in a region (read only) |

`set_block`, `fill`, and `build_*` take `dryRun: true`, which runs nothing and returns the command count, the most blocks that could change, and the bounding box.

Coordinates are absolute integers in the form `[x, y, z]`. Blocks accept block states, such as `oak_stairs[facing=north]`. Shape tools return a short summary (commands run, succeeded, sample failures) instead of dumping every response.

`run_command` can run any command the server console can, so the AI can also change the time, weather, game rules, and entities, give items, and teleport players.

## How an AI builds

1. It calls `get_player_pos` to find a base coordinate.
2. It picks shapes (`fill`, `build_sphere`, ...) and, for fine detail, sends many commands through `run_commands`.
3. It checks results with commands such as `execute if block x y z <block>`, which return "Test passed" or "Test failed".

## Troubleshooting

**`Failed to connect`**

- The server is not running, or RCON is not enabled. Check that `enable-rcon=true` is set and the server was restarted.
- The host is wrong. If the server runs on Windows and the AI runs in WSL2, `127.0.0.1` may not reach it. Use the Windows host IP (the default gateway shown by `ip route show default`) as `MC_RCON_HOST`, or switch WSL to mirrored networking (`networkingMode=mirrored` in `.wslconfig`).

**Command syntax errors**

Command syntax changes between Minecraft versions. For example, in 26.x `time query daytime` no longer exists and you use `time query day`. Let the AI read the error and retry, or ask it to check the command with `run_command` first.

## Undo

Before `set_block`, `fill`, and `build_*` write, the MCP copies the region to a backup area with `/clone`, so block states and block entities such as chest contents come back exactly. The backup area is far from the spawn (`undo.origin`) and its chunks are force-loaded only while an entry is kept. `undo` copies it back and clears the backup.

- History is per server and per operation. Entries can only be undone newest first, because restoring an old one under a newer overlapping build would corrupt the world.
- If the backup fails, nothing is written. If the restore fails, the entry is kept so you can retry.
- The region must be loaded, because `/clone` needs loaded chunks. Everything runs in the dimension RCON commands use (the overworld).
- `run_command` and `run_commands` are **not** covered. The MCP cannot know what an arbitrary command changes. Build the part you may want back with `fill` or `build_*`.
- Entities (mobs, dropped items) are not saved.

## Safety

- RCON is unencrypted and has full control of the server. Never expose the RCON port to the internet. Use a strong password and a firewall.
- `stop`, `op`, `ban`, and similar commands are refused by default (see the settings file). Only connect to servers you own, and tighten `commands.allow` if the AI should do less.
- `undo` covers `set_block`, `fill`, and `build_*` only. Back up the world before large builds, and before anything done through `run_command`. `MC_MAX_VOLUME` refuses oversized single operations.
- Only server-side commands are available. Client-side actions such as camera, movement, and screenshots are out of scope.

## Development

```sh
pnpm check   # type check and unit tests (no server needed)
pnpm test    # unit tests only
pnpm start   # start the MCP server on stdio
```

| File | Role |
|---|---|
| `src/rcon.ts` | Minimal RCON client |
| `src/servers.ts` | Server registry, config file, SSH tunnels |
| `src/builders.ts` | Pure functions that turn shapes into command lists |
| `src/policy.ts` | Command allow list and deny list |
| `src/plan.ts` | Works out which blocks a command list changes |
| `src/history.ts` | Backup before writing, and undo |
| `src/ops.ts` | Shared flow for writes: policy, dry run, backup, run |
| `src/inspect.ts` | Block counts for a region |
| `src/config.ts` | Settings file |
| `src/index.ts` | MCP tool definitions |

## Roadmap

- A log file of operations
- More shapes: pyramid, arch, spiral stairs, roof, walls with windows
- Paste a schematic (`.schem` / `.nbt`) at a position
- Copy and paste a region, with rotation and flipping
- Block palettes that mix blocks by ratio
- Check block names per Minecraft version before running
- Absorb command syntax differences between versions
- Progress notifications during long builds
- A companion MCP that reports a user's installed mods

## License

[MIT](LICENSE)
