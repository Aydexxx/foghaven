import { useCallback, useState } from "react";
import type { Room } from "colyseus.js";
import type { GameState } from "./net/types";
import { Lobby } from "./ui/Lobby";
import { GameView } from "./ui/GameView";

function App() {
  const [room, setRoom] = useState<Room<GameState> | null>(null);

  const handleLeave = useCallback(() => setRoom(null), []);

  return (
    <div className="app">
      {room ? (
        <GameView room={room} onLeave={handleLeave} />
      ) : (
        <Lobby onJoined={setRoom} />
      )}
    </div>
  );
}

export default App;
