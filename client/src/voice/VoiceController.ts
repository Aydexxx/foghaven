import type { Room } from "colyseus.js";
import {
  proximityGain,
  VOICE_MODE,
  VOICE_CHANNEL,
  type IceServerConfig,
  type VoiceChannel,
  type VoiceConfigMessage,
  type VoiceMode,
  type VoiceRosterMessage,
  type VoiceSignalMessage,
} from "@foghaven/shared";
import type { GameState, PlayerState } from "../net/types";

/**
 * The proximity-voice WebRTC mesh, client side. One instance per live game
 * connection; it owns the microphone capture, every peer `RTCPeerConnection`,
 * and the per-peer volume.
 *
 * The mesh is deliberately dumb about *who* it may connect to — that decision
 * is the server's, delivered as a roster (`VoiceRosterMessage`). This class
 * only ever connects to the session ids the server put in that roster, and the
 * server never puts a peer across the living/dead wall into it for a
 * DISCLOSED death — a dead player whose death is public knowledge is simply
 * never in a living player's roster, and the server refuses to relay
 * signalling to them anyway. See the server's `voicePeersFor`.
 *
 * The one deliberate exception is a covert kill's undisclosed window: the
 * victim's id stays in their former living peers' rosters as cover (so a
 * roster's SHAPE never betrays a kill nobody has found out about yet), and
 * this class dutifully keeps that connection alive like any other peer. What
 * actually stops the victim being heard during that window is
 * `msg.deathMuted` (see `applyRoster`) forcing their own outgoing mic off —
 * this class does not and cannot special-case "is this peer secretly dead" on
 * its own, by design; it only ever acts on what the server tells IT to do
 * with ITS OWN mic.
 *
 * Negotiation uses the "perfect negotiation" pattern so the two ends can both
 * create their side of a connection at once (which is exactly what happens when
 * a roster adds a peer to both clients simultaneously) without an offer
 * collision wedging the link — one end is designated polite and rolls back on
 * glare. See `handleSignal`.
 */

export interface VoicePeerView {
  id: string;
  /** Whether the local player has muted this peer's incoming audio. */
  muted: boolean;
  /** Whether the underlying peer connection is currently connected. */
  connected: boolean;
}

/** The slice of controller state the UI renders. Pushed on every change. */
export interface VoiceUiState {
  /** True once the mic is captured and the mesh is running. */
  active: boolean;
  channel: VoiceChannel;
  mode: VoiceMode;
  selfMuted: boolean;
  /** The Silencer gagged this client for the meeting — mic forced off. */
  selfSilenced: boolean;
  /** This client died and the kill is still undisclosed — mic forced off. See `VoiceRosterMessage.deathMuted`. */
  deathMuted: boolean;
  pushToTalk: boolean;
  /** Whether the mic is actually transmitting right now (open, unmuted, PTT held). */
  transmitting: boolean;
  /** Local mic input level, 0..1, for the level meter. */
  micLevel: number;
  peers: VoicePeerView[];
}

interface PeerConnection {
  pc: RTCPeerConnection;
  /** Perfect-negotiation bookkeeping. */
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  /** WebAudio gain node the proximity/equal volume is written to. */
  gain?: GainNode;
  /** A muted sink element — a Chrome quirk needs the remote stream attached to one for WebAudio to pull it. */
  sink?: HTMLAudioElement;
}

/** How often the per-peer volume is recomputed from positions, in ms. */
const GAIN_TICK_MS = 120;
/** Time constant for gain ramps, so volume glides rather than clicking. */
const GAIN_RAMP_S = 0.08;
/** How often the mic level meter samples, in ms. */
const MIC_LEVEL_TICK_MS = 100;

export class VoiceController {
  private readonly room: Room<GameState>;
  private readonly localId: string;
  private readonly onState: (state: VoiceUiState) => void;

  private started = false;
  private disposed = false;

  private audioCtx?: AudioContext;
  private localStream?: MediaStream;
  private analyser?: AnalyserNode;
  private micLevel = 0;

  private iceServers: IceServerConfig[] = [];
  private mode: VoiceMode = VOICE_MODE.PROXIMITY;
  private channel: VoiceChannel = VOICE_CHANNEL.LIVING;
  private selfSilenced = false;
  /**
   * Server directive: force the mic off because this client died and the
   * kill is still undisclosed — see `VoiceRosterMessage.deathMuted`'s own
   * doc. Distinct from `selfMuted` (the player's own manual toggle, below)
   * and from `selfSilenced` (the Silencer ability): this one exists so a
   * covertly killed player's roster entry can keep looking exactly like a
   * living peer's without that player actually being audible.
   */
  private deathMuted = false;

  private selfMuted = false;
  private pushToTalk = false;
  private pttActive = false;

  private readonly peers = new Map<string, PeerConnection>();
  private readonly mutedPeers = new Set<string>();
  private lastRosterPeers: string[] = [];

  private gainTimer?: ReturnType<typeof setInterval>;
  private micTimer?: ReturnType<typeof setInterval>;
  private readonly offHandlers: Array<() => void> = [];

  constructor(room: Room<GameState>, onState: (state: VoiceUiState) => void) {
    this.room = room;
    this.localId = room.sessionId;
    this.onState = onState;
  }

  /**
   * Capture the mic and join the mesh. Requesting the microphone here — behind
   * an explicit user action, never automatically — is deliberate: voice is
   * opt-in, and a browser will refuse `getUserMedia` outside a user gesture
   * anyway. Throws if the user denies the mic or the browser has no media
   * devices, which the hook surfaces as an error.
   */
  async start(): Promise<void> {
    if (this.started || this.disposed) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("voice/unsupported");
    }

    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new AudioCtx!();
    // Autoplay policy can leave the context suspended until a gesture; the
    // click that called `start` is one, so this resumes cleanly.
    void this.audioCtx.resume().catch(() => {});

    // Mic level meter: analyse the local mic, but do NOT wire it to the
    // destination — routing your own mic to your own speakers is an echo, not a
    // feature.
    const micSource = this.audioCtx.createMediaStreamSource(this.localStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 256;
    micSource.connect(this.analyser);

    this.started = true;
    this.applyOutgoingState();

    // Attach the room handlers before announcing readiness, so the config and
    // roster the server sends straight back are never missed.
    this.offHandlers.push(
      this.room.onMessage<VoiceConfigMessage>("voiceConfig", (msg) => {
        this.iceServers = msg.iceServers ?? [];
        // A roster may have landed first; rebuild the mesh now that we can.
        this.reconcile(this.lastRosterPeers);
      }),
      this.room.onMessage<VoiceRosterMessage>("voiceRoster", (msg) => this.applyRoster(msg)),
      this.room.onMessage<VoiceSignalMessage>("voice_signal", (msg) => void this.handleSignal(msg)),
    );

    this.room.send("voice_ready");

    this.gainTimer = setInterval(() => this.updateGains(), GAIN_TICK_MS);
    this.micTimer = setInterval(() => this.updateMicLevel(), MIC_LEVEL_TICK_MS);

    this.emit();
  }

  /** Leave the mesh and release the mic. Idempotent; safe to call from teardown. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    if (this.started) {
      try {
        this.room.send("voice_stop");
      } catch {
        // The socket may already be gone (that is often *why* we're disposing);
        // closing the peer connections below is what actually matters.
      }
    }

    if (this.gainTimer) clearInterval(this.gainTimer);
    if (this.micTimer) clearInterval(this.micTimer);
    for (const off of this.offHandlers) off();
    this.offHandlers.length = 0;

    for (const peerId of [...this.peers.keys()]) {
      this.closePeer(peerId);
    }

    this.localStream?.getTracks().forEach((track) => track.stop());
    void this.audioCtx?.close().catch(() => {});

    this.started = false;
    this.emit();
  }

  // --- Local controls ------------------------------------------------------

  toggleSelfMute(): void {
    this.selfMuted = !this.selfMuted;
    this.applyOutgoingState();
    this.emit();
  }

  setPushToTalk(enabled: boolean): void {
    this.pushToTalk = enabled;
    // Leaving PTT mode should never strand the mic in the "key up = silent"
    // state, so drop the transient hold flag as the mode changes.
    this.pttActive = false;
    this.applyOutgoingState();
    this.emit();
  }

  /** Press/release for push-to-talk. A no-op in open-mic mode. */
  setPttActive(active: boolean): void {
    if (!this.pushToTalk || this.pttActive === active) {
      return;
    }
    this.pttActive = active;
    this.applyOutgoingState();
    this.emit();
  }

  togglePeerMute(peerId: string): void {
    if (this.mutedPeers.has(peerId)) {
      this.mutedPeers.delete(peerId);
    } else {
      this.mutedPeers.add(peerId);
    }
    this.updateGains();
    this.emit();
  }

  // --- Roster & signalling -------------------------------------------------

  private applyRoster(msg: VoiceRosterMessage): void {
    this.mode = msg.mode;
    this.channel = msg.channel;
    this.selfSilenced = msg.selfSilenced;
    this.deathMuted = msg.deathMuted;
    this.lastRosterPeers = msg.peers;
    this.applyOutgoingState();
    this.reconcile(msg.peers);
    this.emit();
  }

  /**
   * Bring the live peer connections in line with the roster: open one to every
   * peer that appeared, close every one that dropped off. Idempotent — a roster
   * that repeats an existing peer changes nothing for it.
   */
  private reconcile(peerIds: string[]): void {
    if (!this.started || this.disposed) {
      return;
    }
    const wanted = new Set(peerIds);
    for (const peerId of [...this.peers.keys()]) {
      if (!wanted.has(peerId)) {
        this.closePeer(peerId);
      }
    }
    for (const peerId of peerIds) {
      if (!this.peers.has(peerId)) {
        this.openPeer(peerId);
      }
    }
  }

  private openPeer(peerId: string): void {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[] });
    // The tie-breaker for perfect negotiation: one end polite, one impolite,
    // decided by a stable comparison both ends compute the same way.
    const peer: PeerConnection = { pc, polite: this.localId > peerId, makingOffer: false, ignoreOffer: false };
    this.peers.set(peerId, peer);

    // Send our mic. Adding the track is what triggers `onnegotiationneeded`,
    // so both ends kicking this off at once is the collision perfect
    // negotiation is built to absorb.
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(peerId, { description: this.plainDescription(pc.localDescription) });
      } catch {
        // A failed offer round is retried by the next negotiation the browser
        // schedules; nothing to unwind here.
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.signal(peerId, { candidate: candidate.toJSON() });
      }
    };

    pc.ontrack = ({ streams }) => {
      const stream = streams[0];
      if (stream) {
        this.attachRemote(peer, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        // A relay path exists (TURN) but the link still failed; a fresh
        // negotiation is the cheapest recovery. Kept simple: drop it and let
        // the next roster (or the peer's own retry) rebuild.
        pc.restartIce?.();
      }
      this.emit();
    };
  }

  private attachRemote(peer: PeerConnection, stream: MediaStream): void {
    if (!this.audioCtx) {
      return;
    }
    const source = this.audioCtx.createMediaStreamSource(stream);
    const gain = this.audioCtx.createGain();
    gain.gain.value = 0; // The proximity loop sets the real value immediately.
    source.connect(gain).connect(this.audioCtx.destination);
    peer.gain = gain;

    // WebAudio in Chromium won't pull from a `MediaStreamSource` fed by WebRTC
    // unless the stream is also sunk to a media element. Mute it so playback
    // itself comes only from the WebAudio graph above (where the gain lives).
    const sink = new Audio();
    sink.srcObject = stream;
    sink.muted = true;
    void sink.play().catch(() => {});
    peer.sink = sink;

    this.updateGains();
  }

  private closePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) {
      return;
    }
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    try {
      peer.pc.close();
    } catch {
      // Already closed — nothing to do.
    }
    if (peer.sink) {
      peer.sink.srcObject = null;
    }
    this.peers.delete(peerId);
  }

  private async handleSignal(msg: VoiceSignalMessage): Promise<void> {
    const from = msg.from;
    if (!from) {
      return;
    }
    const peer = this.peers.get(from);
    if (!peer) {
      // A signal from someone not (yet) in our roster — could be a race with a
      // roster we haven't applied. Dropping it is safe: the peer will
      // renegotiate once both ends agree we're connected.
      return;
    }
    const { pc } = peer;
    try {
      if (msg.description) {
        const description = msg.description as RTCSessionDescriptionInit;
        const offerCollision =
          description.type === "offer" && (peer.makingOffer || pc.signalingState !== "stable");
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) {
          return;
        }
        await pc.setRemoteDescription(description);
        if (description.type === "offer") {
          await pc.setLocalDescription();
          this.signal(from, { description: this.plainDescription(pc.localDescription) });
        }
      } else if (msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit);
        } catch (err) {
          // A candidate rejected because we deliberately ignored its offer is
          // expected; anything else is a real error worth not swallowing.
          if (!peer.ignoreOffer) {
            throw err;
          }
        }
      }
    } catch {
      // Signalling errors self-heal on the next negotiation; a wedged link is
      // rebuilt when the roster next changes.
    }
  }

  private signal(to: string, body: { description?: unknown; candidate?: unknown }): void {
    const payload: VoiceSignalMessage = { to, ...body };
    try {
      this.room.send("voice_signal", payload);
    } catch {
      // Socket gone; the mesh is about to be torn down anyway.
    }
  }

  /** Flatten an SDP description to a plain object so msgpack can carry it. */
  private plainDescription(
    description: RTCSessionDescription | null,
  ): RTCSessionDescriptionInit | undefined {
    return description ? { type: description.type, sdp: description.sdp } : undefined;
  }

  // --- Volume & metering ---------------------------------------------------

  private updateGains(): void {
    if (!this.audioCtx) {
      return;
    }
    const now = this.audioCtx.currentTime;
    const self = this.room.state.players.get(this.localId);
    for (const [peerId, peer] of this.peers) {
      if (!peer.gain) {
        continue;
      }
      const target = this.targetGainFor(peerId, self);
      peer.gain.gain.setTargetAtTime(target, now, GAIN_RAMP_S);
    }
  }

  private targetGainFor(peerId: string, self: PlayerState | undefined): number {
    if (this.mutedPeers.has(peerId)) {
      return 0;
    }
    if (this.mode === VOICE_MODE.EQUAL) {
      return 1;
    }
    const other = this.room.state.players.get(peerId);
    if (!self || !other) {
      // No position for one of us — the peer is beyond the fog, so from here
      // they are simply out of earshot. Silent, never a leak of where they are.
      return 0;
    }
    return proximityGain(Math.hypot(self.x - other.x, self.y - other.y));
  }

  private updateMicLevel(): void {
    if (!this.analyser) {
      return;
    }
    const buffer = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buffer);
    let sumSquares = 0;
    for (const sample of buffer) {
      const centered = (sample - 128) / 128;
      sumSquares += centered * centered;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    // Only show level when the mic is actually going out — a muted mic reading
    // "hot" would just be confusing.
    const level = this.isTransmitting() ? Math.min(1, rms * 2.5) : 0;
    if (Math.abs(level - this.micLevel) > 0.02) {
      this.micLevel = level;
      this.emit();
    }
  }

  /** Whether the mic is currently sending audio: started, not muted, not gagged, not (secretly) dead, and (in PTT) held. */
  private isTransmitting(): boolean {
    return (
      this.started &&
      !this.selfMuted &&
      !this.selfSilenced &&
      !this.deathMuted &&
      (!this.pushToTalk || this.pttActive)
    );
  }

  /** Push the transmit decision onto the actual mic track. */
  private applyOutgoingState(): void {
    const transmitting = this.isTransmitting();
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = transmitting;
    });
  }

  private emit(): void {
    this.onState(this.snapshot());
  }

  private snapshot(): VoiceUiState {
    return {
      active: this.started,
      channel: this.channel,
      mode: this.mode,
      selfMuted: this.selfMuted,
      selfSilenced: this.selfSilenced,
      deathMuted: this.deathMuted,
      pushToTalk: this.pushToTalk,
      transmitting: this.isTransmitting(),
      micLevel: this.micLevel,
      peers: [...this.peers.entries()].map(([id, peer]) => ({
        id,
        muted: this.mutedPeers.has(id),
        connected: peer.pc.connectionState === "connected",
      })),
    };
  }
}
