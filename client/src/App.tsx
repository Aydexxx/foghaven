import { useCallback, useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { PHASE, type RoleAssignment } from "@foghaven/shared";
import type { GameState } from "./net/types";
import { NameEntry } from "./ui/NameEntry";
import { MainMenu } from "./ui/MainMenu";
import { LobbyRoom } from "./ui/LobbyRoom";
import { RoleReveal } from "./ui/RoleReveal";
import { GameView } from "./ui/GameView";

type Screen = "name" | "menu" | "lobby" | "reveal" | "game";

const SCREEN_FOR_PHASE: Record<string, Screen> = {
  [PHASE.LOBBY]: "lobby",
  [PHASE.ROLE_REVEAL]: "reveal",
  [PHASE.PLAYING]: "game",
};

function App() {
  const [screen, setScreen] = useState<Screen>("name");
  const [name, setName] = useState("");
  const [room, setRoom] = useState<Room<GameState> | null>(null);
  const [assignment, setAssignment] = useState<RoleAssignment | null>(null);
  const [playerCount, setPlayerCount] = useState(0);

  const handleNameSubmit = useCallback((value: string) => {
    setName(value);
    setScreen("menu");
  }, []);

  const handleJoined = useCallback((joinedRoom: Room<GameState>) => {
    setRoom(joinedRoom);
    setAssignment(null);
    setScreen(SCREEN_FOR_PHASE[joinedRoom.state.phase] ?? "lobby");
  }, []);

  const returnToMenu = useCallback(() => {
    setRoom(null);
    setAssignment(null);
    setScreen("menu");
  }, []);

  const leaveRoom = useCallback(() => {
    void room?.leave();
    returnToMenu();
  }, [room, returnToMenu]);

  useEffect(() => {
    if (!room) {
      return;
    }

    // The private role message. It is registered here rather than inside the
    // reveal screen because it arrives just *before* the phase flips — the
    // screen that displays it does not exist yet when it lands.
    const offRole: () => void = room.onMessage<RoleAssignment>("role", setAssignment);

    // The server drives every phase transition; the client only follows. That
    // keeps the reveal on screen for the same window for everyone and means a
    // client cannot skip ahead into the world early.
    const unlistenPhase = room.state.listen("phase", (phase) => {
      const next = SCREEN_FOR_PHASE[phase];
      if (next) {
        setScreen(next);
      }
    });

    const syncCount = () => setPlayerCount(room.state.players.size);
    room.onStateChange(syncCount);
    syncCount();

    const handleForcedLeave = () => returnToMenu();
    room.onLeave(handleForcedLeave);

    return () => {
      offRole();
      unlistenPhase();
      room.onStateChange.remove(syncCount);
      room.onLeave.remove(handleForcedLeave);
    };
  }, [room, returnToMenu]);

  return (
    <div className="app">
      {screen === "name" && <NameEntry name={name} onSubmit={handleNameSubmit} />}
      {screen === "menu" && <MainMenu name={name} onJoined={handleJoined} />}
      {screen === "lobby" && room && <LobbyRoom room={room} onLeave={leaveRoom} />}
      {screen === "reveal" && (
        <RoleReveal assignment={assignment} playerCount={playerCount} />
      )}
      {screen === "game" && room && <GameView room={room} onLeave={leaveRoom} />}
    </div>
  );
}

export default App;
