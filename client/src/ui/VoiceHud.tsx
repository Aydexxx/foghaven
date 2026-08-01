import { useTranslation } from "react-i18next";
import type { Room } from "colyseus.js";
import { VOICE_CHANNEL, VOICE_MODE } from "@foghaven/shared";
import type { GameState } from "../net/types";
import type { UseVoice } from "../voice/useVoice";
import { Button, Panel } from "./primitives";

interface VoiceHudProps {
  room: Room<GameState>;
  voice: UseVoice;
}

/**
 * The voice control surface: a compact panel pinned in the corner during play
 * and meetings. It renders whatever the controller reports and nothing it
 * decides itself — who you can hear, whether you're gagged, and how volume is
 * weighted are all the server's calls, arriving as controller state. The one
 * thing owned here is the local player's own controls (join/leave, self-mute,
 * push-to-talk, and muting individual peers), which are always accessible.
 */
export function VoiceHud({ room, voice }: VoiceHudProps) {
  const { t } = useTranslation();

  if (!voice.supported) {
    return null;
  }

  // Not joined yet: a single opt-in button (plus any error from a denied mic).
  if (!voice.enabled) {
    return (
      <Panel className="voice-hud voice-hud-collapsed">
        <Button variant="primary" className="voice-join" onClick={voice.enable} disabled={voice.enabling}>
          🎙️ {voice.enabling ? t("voice.joining") : t("voice.join")}
        </Button>
        {voice.error && (
          <p className="voice-error" role="alert">
            {voice.error === "voice/unsupported"
              ? t("voice.unsupported")
              : voice.error.includes("Permission") || voice.error.includes("denied")
                ? t("voice.permissionDenied")
                : t("voice.failed")}
          </p>
        )}
      </Panel>
    );
  }

  const state = voice.state;
  if (!state) {
    return null;
  }

  const channelLabel =
    state.channel === VOICE_CHANNEL.DEAD ? t("voice.channelDead") : t("voice.channelLiving");
  const modeLabel = state.mode === VOICE_MODE.EQUAL ? t("voice.equal") : t("voice.proximity");
  const meterWidth = `${Math.round(state.micLevel * 100)}%`;

  return (
    <Panel className="voice-hud">
      <header className="voice-hud-header">
        <span className="voice-channel">{channelLabel}</span>
        <span className="voice-mode">{modeLabel}</span>
      </header>

      {state.selfSilenced && (
        <p className="voice-silenced" role="status">
          {t("voice.silenced")}
        </p>
      )}

      <div className="voice-self">
        <div
          className={`voice-meter${state.transmitting ? " is-live" : ""}`}
          aria-label={state.transmitting ? t("voice.speaking") : t("voice.muted")}
        >
          <span className="voice-meter-fill" style={{ width: meterWidth }} />
        </div>
        <Button
          className={`voice-mic-toggle${state.selfMuted ? " is-muted" : ""}`}
          onClick={voice.toggleSelfMute}
          aria-pressed={state.selfMuted}
        >
          {state.selfMuted ? t("voice.unmuteSelf") : t("voice.muteSelf")}
        </Button>
      </div>

      <label className="voice-ptt">
        <input
          type="checkbox"
          checked={state.pushToTalk}
          onChange={(event) => voice.setPushToTalk(event.target.checked)}
        />
        {state.pushToTalk ? t("voice.pushToTalk") : t("voice.openMic")}
      </label>

      <div className="voice-peers">
        <p className="voice-peers-heading">{t("voice.peersHeading")}</p>
        {state.peers.length === 0 ? (
          <p className="voice-peers-empty">{t("voice.noPeers")}</p>
        ) : (
          <ul>
            {state.peers.map((peer) => {
              const name = room.state.players.get(peer.id)?.name ?? t("voice.unknownPlayer");
              return (
                <li key={peer.id} className={peer.connected ? "is-connected" : "is-connecting"}>
                  <span className="voice-peer-name">{name}</span>
                  <Button
                    className={`voice-peer-mute${peer.muted ? " is-muted" : ""}`}
                    onClick={() => voice.togglePeerMute(peer.id)}
                    aria-pressed={peer.muted}
                  >
                    {peer.muted ? t("voice.unmutePeer") : t("voice.mutePeer")}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Button className="voice-leave" onClick={voice.disable}>
        {t("voice.leave")}
      </Button>
    </Panel>
  );
}
