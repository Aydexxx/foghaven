import { useEffect, useRef } from "react";
import Phaser from "phaser";
import type { Room } from "colyseus.js";
import { MAP } from "@foghaven/shared";
import type { GameState } from "../net/types";
import { GameScene } from "./GameScene";

/** World size in pixels — the shared map bounds the server clamps against. */
const WORLD_WIDTH = MAP.width;
const WORLD_HEIGHT = MAP.height;

interface GameCanvasProps {
  room: Room<GameState>;
}

/**
 * Bridges React and Phaser: React owns the surrounding UI, this component owns
 * the canvas. The Phaser game is created once per room and fully destroyed on
 * unmount so nothing leaks across React StrictMode remounts.
 */
export function GameCanvas({ room }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
      backgroundColor: "#1d1d26",
      scene: [],
    });

    game.scene.add("game", GameScene, true, { room });

    return () => {
      game.destroy(true);
    };
  }, [room]);

  return <div ref={containerRef} className="game-canvas" />;
}
