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

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MC_RCON_HOST` | `127.0.0.1` | Server host |
| `MC_RCON_PORT` | `25575` | RCON port |
| `MC_RCON_PASSWORD` | empty | RCON password |
| `MC_MAX_VOLUME` | `200000` | Maximum number of blocks one operation may change |

## Tools

| Tool | Description |
|---|---|
| `run_command` | Run one command and return its output. A leading `/` is optional |
| `run_commands` | Run up to 2000 commands in order |
| `get_player_pos` | Get a player's position, rotation, and dimension |
| `set_block` | Place one block |
| `fill` | Fill a box. `mode` is `replace`, `hollow`, `outline`, `keep`, or `destroy`. Large boxes are split automatically to stay under the 32768-block limit |
| `build_sphere` | Build a sphere (radius 1 to 60), optionally hollow |
| `build_cylinder` | Build a cylinder (radius 1 to 60, height 1 to 320), optionally hollow |
| `build_line` | Draw a 3D line between two points |

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

## Safety

- RCON is unencrypted and has full control of the server. Never expose the RCON port to the internet. Use a strong password and a firewall.
- `run_command` also allows dangerous commands such as `stop`, `op`, and `ban`. Only connect to servers you own.
- There is no undo. Back up the world before large builds. `MC_MAX_VOLUME` refuses oversized single operations.
- Only server-side commands are available. Client-side actions such as camera, movement, and screenshots are out of scope.

## Development

```sh
pnpm check   # type check
pnpm start   # start the MCP server on stdio
```

| File | Role |
|---|---|
| `src/rcon.ts` | Minimal RCON client |
| `src/builders.ts` | Pure functions that turn shapes into command lists |
| `src/index.ts` | MCP tool definitions |

## Roadmap

- Undo by saving a region before it is overwritten
- A command allow list and deny list
- A companion MCP that reports a user's installed mods

## License

[MIT](LICENSE)
