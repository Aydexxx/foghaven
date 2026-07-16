import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import { GameRoom } from "./rooms/GameRoom";

const port = Number(process.env.PORT ?? 2567);

const app = express();
app.use(express.json());

// Colyseus monitor (development dashboard) at /colyseus.
app.use("/colyseus", monitor());

const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("game", GameRoom);

gameServer.listen(port).then(() => {
  console.log(`Foghaven server listening on ws://localhost:${port}`);
  console.log(`Colyseus monitor at http://localhost:${port}/colyseus`);
});
