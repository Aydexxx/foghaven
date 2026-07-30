/**
 * Proximity voice chat: the shared contract between the client mesh and the
 * server that gates it. Like the rest of `shared/`, this file is rules and
 * message shapes only — no secrets. The one secret voice touches (who is dead)
 * is never expressed here; it lives entirely in the server's authoritative
 * decision about which peers a client is *allowed* to connect to. See
 * `GameRoom`'s voice section and `client/src/voice/VoiceController.ts`.
 *
 * The architecture is a WebRTC full mesh (fine at this game's <=14 players — no
 * SFU), signalled over the existing Colyseus room. Two properties matter and
 * both are enforced server-side, never in the renderer:
 *
 *   1. The dead/living wall, for a DISCLOSED death — one every other client
 *      already knows about (a body's been reported, a meeting's been called).
 *      A living client and a disclosed-dead client must never share a peer
 *      connection — not muted, not silent, *absent*. The server refuses to
 *      relay a signalling message across that boundary, so the connection is
 *      never negotiated.
 *
 *      A freshly, COVERTLY killed player is the one deliberate, temporary
 *      exception: they stay in their former living peers' rosters — not
 *      absent — until the kill is disclosed, so a distant client can't infer
 *      a death from its roster shrinking by one (see `GameRoom.voicePeersFor`
 *      and its `undisclosedKills` set). What actually stops them talking in
 *      that window is `VoiceRosterMessage.deathMuted`, a private directive to
 *      their own client to kill their own outgoing mic — not the wall. Once
 *      disclosed, the roster catches up to reality and the ordinary wall
 *      above applies again, absolute.
 *
 *      Either way this mirrors how `GameState.players` and the chat channels
 *      keep the two populations apart: the data (or, during the undisclosed
 *      window, the ability to transmit) stops at the server's decision, never
 *      something the client is trusted to enforce on itself except by
 *      following a direct instruction.
 *
 *   2. Proximity vs. equal volume is a *mode* the server names per phase
 *      (proximity while playing, equal in a meeting); the client applies the
 *      falloff locally from positions it already has, using `proximityGain`.
 */

/**
 * Within this many world units of a speaker, their voice is at full volume.
 * Comfortably inside both fog vision radii (see `VISION_RADIUS_*`), so anyone
 * you can hear at full strength you can also see — audio never reveals a
 * position the fog is hiding.
 */
export const VOICE_PROXIMITY_FULL_RANGE = 90;

/**
 * Beyond this many world units, a speaker is inaudible. The falloff is linear
 * between the full range and here. Kept a little beyond the outdoor vision
 * radius so a voice fades to nothing right around the edge of sight rather than
 * cutting out abruptly while the speaker is still on screen.
 */
export const VOICE_PROXIMITY_MAX_RANGE = 320;

/**
 * Volume (0..1) for a speaker `distance` world units away under proximity mode.
 * A pure function of distance and the two range constants: full within
 * `VOICE_PROXIMITY_FULL_RANGE`, silent past `VOICE_PROXIMITY_MAX_RANGE`, linear
 * in between. Shared so the falloff is defined once and testable in isolation
 * from any audio hardware.
 */
export function proximityGain(distance: number): number {
  if (!Number.isFinite(distance) || distance <= VOICE_PROXIMITY_FULL_RANGE) {
    return 1;
  }
  if (distance >= VOICE_PROXIMITY_MAX_RANGE) {
    return 0;
  }
  return (
    (VOICE_PROXIMITY_MAX_RANGE - distance) /
    (VOICE_PROXIMITY_MAX_RANGE - VOICE_PROXIMITY_FULL_RANGE)
  );
}

/**
 * How the client should weight peer volume. `proximity` = falloff with
 * distance (open play); `equal` = everyone at full volume (a meeting, where the
 * whole town is gathered and every voice counts equally).
 */
export const VOICE_MODE = {
  PROXIMITY: "proximity",
  EQUAL: "equal",
} as const;

export type VoiceMode = (typeof VOICE_MODE)[keyof typeof VOICE_MODE];

/**
 * Which voice population a client belongs to — the same living/dead split the
 * chat channels use. Carried on the roster purely so the client can label its
 * own state ("you are in the graveyard channel"); the actual separation is the
 * server never listing a cross-channel peer, not this string.
 */
export const VOICE_CHANNEL = {
  LIVING: "living",
  DEAD: "dead",
} as const;

export type VoiceChannel = (typeof VOICE_CHANNEL)[keyof typeof VOICE_CHANNEL];

/**
 * One ICE server entry, shaped to match the browser's `RTCIceServer` without
 * depending on the DOM lib here (shared is consumed by the Node server too).
 * TURN entries carry time-limited credentials minted per connection — see the
 * server's `buildIceServers`.
 */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Delivered to a client the moment it opts into voice (`voice_ready`), before
 * any peer connection is built. Carries the STUN/TURN servers the mesh needs —
 * TURN especially, since a player behind a symmetric NAT can only be reached by
 * relaying through it.
 */
export interface VoiceConfigMessage {
  iceServers: IceServerConfig[];
}

/**
 * The authoritative answer to "who may I have a voice connection with, right
 * now" — recomputed and pushed by the server on every change that can move the
 * boundary (a death, an ejection, a phase change, a peer enabling or leaving
 * voice). The client reconciles its live `RTCPeerConnection`s against `peers`:
 * anyone new gets a connection, anyone gone gets torn down.
 *
 * `peers` already has the dead/living wall applied — a living client's roster
 * never contains a *disclosed*-dead session id, and vice versa — so the client
 * never has to (and never gets to) make that call itself. The one deliberate
 * exception is a covert kill's undisclosed window, where the victim's id stays
 * in their former living peers' rosters as cover; `deathMuted` is what
 * actually silences them for that window, not an absence from `peers`.
 */
export interface VoiceRosterMessage {
  /** Session ids this client is allowed to connect to, wall already applied. */
  peers: string[];
  /** How to weight peer volume this phase. */
  mode: VoiceMode;
  /** Which population this client is in — for its own UI label only. */
  channel: VoiceChannel;
  /**
   * Whether the Silencer has gagged this client for the meeting in progress —
   * the client disables its own outgoing mic while true. Only ever set during a
   * meeting. Deliberately delivered only to the silenced client (not the set of
   * everyone silenced): who is silenced stays as unknown to observers as it is
   * in chat, where a gagged player simply says nothing.
   */
  selfSilenced: boolean;
  /**
   * Whether the server is force-muting this client's outgoing mic because
   * they died and the death has not been disclosed yet (no body reported, no
   * meeting called). The client disables its own outgoing mic while true, the
   * same mechanism `selfSilenced` already uses.
   *
   * This exists because of a deliberate, narrow trade-off: `peers` keeps
   * listing a covertly-killed player's former living peers for a while after
   * death (see `GameRoom.voicePeersFor` and its `undisclosedKills` set) so a
   * distant observer can't infer a kill from their roster shrinking by one.
   * But an unmuted dead player left in that state could keep TALKING to the
   * living they're still nominally connected to — which is a much bigger
   * leak than the one being closed. `deathMuted` is what prevents that: the
   * roster entry survives for cover, but the mic is dead from the instant
   * `alive` flips, full stop, regardless of disclosure.
   *
   * Deliberately delivered only to the muted client itself, same reasoning as
   * `selfSilenced` — nothing here is a signal to anyone watching a roster.
   * Only ever true during the undisclosed window; once a meeting starts, this
   * client is either genuinely in the (real) ghost roster or, once ejected/
   * revealed, simply gone from a living roster the ordinary way — either way
   * `deathMuted` returns to false and a dead player's normal ability to talk
   * to OTHER dead players in the graveyard channel is untouched.
   */
  deathMuted: boolean;
}

/**
 * A WebRTC signalling payload, relayed through the room. A client sends it with
 * `to` set (the intended peer); the server stamps `from` and forwards it — but
 * only to a peer the sender is currently allowed to reach (`voicePeersFor`).
 * A message aimed across the dead/living wall is dropped, which is the whole of
 * the enforcement: no offer crosses, so no connection is ever negotiated.
 *
 * `description` and `candidate` are the two kinds of signalling traffic
 * (SDP offer/answer and ICE candidates); exactly one is set per message. Typed
 * as `unknown` because their concrete DOM types (`RTCSessionDescriptionInit`,
 * `RTCIceCandidateInit`) are opaque to the server, which only ferries them.
 */
export interface VoiceSignalMessage {
  /** Set by the sender: the peer this is meant for. */
  to?: string;
  /** Set by the server when relaying: who it came from. */
  from?: string;
  /** An SDP offer/answer (`RTCSessionDescriptionInit`), if this is a negotiation message. */
  description?: unknown;
  /** An ICE candidate (`RTCIceCandidateInit`), if this is a candidate message. */
  candidate?: unknown;
}
