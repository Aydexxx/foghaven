import { createServer } from "node:http";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { Server } from "@colyseus/core";
import { GAME_CONFIG } from "@foghaven/shared";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: createServer(),
  }),
});

console.log("Loaded game config:", GAME_CONFIG);

gameServer.listen(port).then(() => {
  console.log(`Foghaven server listening on ws://localhost:${port}`);
});
