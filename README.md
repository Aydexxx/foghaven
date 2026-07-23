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
npm test             # run the shared, server and client test suites
```

## Moderation

The moderation panel lives at `/admin` (server) and behind the 🛡️ button in
the client. Every route re-reads the caller's role from the database, so
privilege can be granted and revoked at any time and takes effect immediately.

Granting the *first* moderator needs database access rather than an existing
admin — otherwise nobody could ever reach the panel:

```bash
npm run grant-role -w server -- <username> admin       # or: moderator, player
```

Bans can also be issued without the panel, as a break-glass path:

```bash
npm run ban -w server -- <username> "<reason>"                       # permanent
npm run ban -w server -- <username> "<reason>" --until 2026-12-31T00:00:00Z
npm run ban -w server -- <username> --unban
```

Chat is retained for report review for `CHAT_LOG_RETENTION_DAYS` (30) and then
deleted by a sweep that runs at boot and every six hours. Reports snapshot
their own chat evidence at filing time, so they stay reviewable after the logs
behind them have aged out.

## License

MIT — see [LICENSE](LICENSE).
