# Foghaven

A web-based, real-time multiplayer social deduction game.

## Structure

- `/server` — Colyseus + TypeScript authoritative game server
- `/client` — React + TypeScript + Vite + Phaser 3
- `/shared` — shared types, constants, and game config

## Setup

```bash
npm install
```

## Development

```bash
npm run dev:server   # start the game server
npm run dev:client   # start the client dev server
```

## Other scripts

```bash
npm run typecheck   # type-check all workspaces
npm run build        # build all workspaces
```

## License

MIT — see [LICENSE](LICENSE).
