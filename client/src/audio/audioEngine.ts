import type { RoomSlug } from "@foghaven/shared";
import { RoomAmbience } from "./synth/ambience";
import { FootstepVoice } from "./synth/footstep";
import {
  playBellTollStinger,
  playBodyFoundStinger,
  playEjectionStinger,
  playKillStinger,
  playLossStinger,
  playMeetingStartStinger,
  playSabotageAlarmStinger,
  playTaskCompleteStinger,
  playTaskInjuryStinger,
  playTunnelStinger,
  playWinStinger,
} from "./synth/stingers";
import {
  DEFAULT_AUDIO_SETTINGS,
  loadAudioSettings,
  saveAudioSettings,
  type AudioBus,
  type AudioSettings,
} from "./settings";

export type StingerKind =
  | "kill"
  | "bodyFound"
  | "meetingStart"
  | "sabotageAlarm"
  | "ejection"
  | "bellToll"
  | "win"
  | "loss"
  | "tunnel"
  | "taskComplete"
  | "taskInjury";

const STINGERS: Record<StingerKind, typeof playKillStinger> = {
  kill: playKillStinger,
  bodyFound: playBodyFoundStinger,
  meetingStart: playMeetingStartStinger,
  sabotageAlarm: playSabotageAlarmStinger,
  ejection: playEjectionStinger,
  bellToll: playBellTollStinger,
  win: playWinStinger,
  loss: playLossStinger,
  tunnel: playTunnelStinger,
  taskComplete: playTaskCompleteStinger,
  taskInjury: playTaskInjuryStinger,
};

const VOLUME_RAMP_S = 0.05;

/**
 * The audio engine: one `AudioContext`, one sfx bus feeding one master gain,
 * and everything else in `audio/` plugged into it. A single module-level
 * instance (`audioEngine`, exported below) — not a React context — because
 * its two callers are on opposite sides of a
 * boundary this codebase already draws elsewhere: `GameScene` is a Phaser
 * class outside React's tree entirely (see how it already imports shared
 * config directly rather than receiving it as props), and the settings
 * panel is plain React. A plain singleton is the one shape both can reach
 * without threading it through either.
 *
 * Nothing here plays until `unlock()` has run inside a real user gesture —
 * every browser refuses to start audio otherwise — and nothing here is
 * fallible in a way that should ever break the game: every method is a
 * no-op before unlock, matching how `net/session.ts` treats storage
 * failures as something to shrug off, not surface.
 */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambience: RoomAmbience | null = null;
  private readonly footsteps = new Map<string, FootstepVoice>();
  private settings: AudioSettings = loadAudioSettings();
  private readonly listeners = new Set<() => void>();
  private resumeRetryArmed = false;

  /**
   * Create the audio graph and attempt to start it. Safe to call many
   * times — the graph is built once, and every later call just retries
   * `resume()`, which is what actually needs a fresh user gesture on
   * browsers that suspended the context (e.g. a reload mid-round, which has
   * no click of its own to unlock with — see the retry listener below).
   */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.masterGain);

      this.applyVolumes();

      this.ambience = new RoomAmbience(ctx, this.sfxBus);
    }

    void this.ctx.resume().catch(() => {
      // Ignored — the retry listener below covers the case that matters.
    });

    if (this.ctx.state !== "running" && !this.resumeRetryArmed) {
      this.resumeRetryArmed = true;
      const retry = () => {
        void this.ctx?.resume();
        if (this.ctx?.state === "running") {
          window.removeEventListener("pointerdown", retry);
          window.removeEventListener("keydown", retry);
          this.resumeRetryArmed = false;
        }
      };
      window.addEventListener("pointerdown", retry);
      window.addEventListener("keydown", retry);
    }
  }

  // --- Settings -------------------------------------------------------

  getSettings(): AudioSettings {
    return this.settings;
  }

  setVolume(bus: AudioBus, value: number): void {
    const clamped = Math.min(1, Math.max(0, value));
    this.settings = { ...this.settings, [bus]: clamped };
    this.commitSettings();
  }

  setMuted(bus: AudioBus, muted: boolean): void {
    const key = bus === "master" ? "mutedMaster" : "mutedSfx";
    this.settings = { ...this.settings, [key]: muted };
    this.commitSettings();
  }

  /** Subscribe to settings changes (for the React settings panel); returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commitSettings(): void {
    saveAudioSettings(this.settings);
    this.applyVolumes();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.masterGain || !this.sfxBus) {
      return;
    }
    const now = this.ctx.currentTime;
    const master = this.settings.mutedMaster ? 0 : this.settings.master;
    const sfx = this.settings.mutedSfx ? 0 : this.settings.sfx;
    this.ramp(this.masterGain, master, now);
    this.ramp(this.sfxBus, sfx, now);
  }

  private ramp(node: GainNode, target: number, now: number): void {
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    node.gain.linearRampToValueAtTime(target, now + VOLUME_RAMP_S);
  }

  // --- Stingers ---------------------------------------------------------

  playStinger(kind: StingerKind): void {
    if (!this.ctx || !this.sfxBus) {
      return;
    }
    STINGERS[kind]({ ctx: this.ctx, destination: this.sfxBus });
  }

  // --- Ambience -------------------------------------------------------

  setRoom(slug: RoomSlug): void {
    this.ambience?.setRoom(slug);
  }

  // --- Footsteps ----------------------------------------------------------

  /** Update (creating if needed) a remote player's footstep spatial position — cheap, call every frame for anyone currently audible. */
  updateFootstepSpatial(sourceId: string, pan: number, proximity: number): void {
    if (!this.ctx || !this.sfxBus) {
      return;
    }
    let voice = this.footsteps.get(sourceId);
    if (!voice) {
      voice = new FootstepVoice(this.ctx, this.sfxBus);
      this.footsteps.set(sourceId, voice);
    }
    voice.updateSpatial(pan, proximity);
  }

  /** Fire one footfall for a source already positioned via `updateFootstepSpatial`. */
  triggerFootstep(sourceId: string): void {
    this.footsteps.get(sourceId)?.step();
  }

  /** Drop a source's footstep voice — call when they leave fog, die, or disconnect. */
  removeFootstepSource(sourceId: string): void {
    this.footsteps.get(sourceId)?.dispose();
    this.footsteps.delete(sourceId);
  }

  /**
   * Back to a neutral resting state between rounds — ambience returns to
   * the open streets and every footstep voice drops. The context, buses
   * and settings all survive: this is "a new round is starting," not "the
   * player left the game."
   */
  reset(): void {
    this.setRoom("streets");
    for (const id of [...this.footsteps.keys()]) {
      this.removeFootstepSource(id);
    }
  }
}

export const audioEngine = new AudioEngine();
export { DEFAULT_AUDIO_SETTINGS };
export type { AudioBus, AudioSettings };

if (import.meta.env.DEV) {
  (globalThis as unknown as { __foghavenAudio?: AudioEngine }).__foghavenAudio = audioEngine;
}
