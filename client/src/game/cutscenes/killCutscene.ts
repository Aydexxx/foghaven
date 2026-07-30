import Phaser from "phaser";
import { juice, VIGNETTE_BASE_INTENSITY } from "../../juice/JuiceDirector";
import { buildSplatterTextures, splatterKeyFor } from "./bloodSplatter";

/**
 * The kill, as ART_BIBLE §10.1 specifies it: **a five-beat timeline, not a
 * state transition.**
 *
 * That distinction is the design. A state transition asks "is this player
 * dead?" and renders the answer; a timeline says "these five things happen, in
 * this order, over these durations" and plays them regardless of how quickly
 * the underlying state settles. Written as a transition, beat 4's rolling
 * lantern would be at the mercy of whatever the next state patch happens to
 * say, and the beat that §10.1 calls "the whole scene" would be the first
 * thing to get clipped. The beats below therefore own their own clock end to
 * end, and read game state only to decide *where* to play, never *whether* to
 * continue.
 *
 * ---
 *
 * ## Who sees this
 *
 * The killer and the victim. Nobody else — and that is enforced by what the
 * server sends, not by anything in this file. There are exactly two triggers,
 * `killConfirmed` (sent only to the actor, see `abilities/kill.ts`) and
 * `killed` (sent only to the victim, see `GameRoom.killPlayer`), and this
 * module is reachable from nowhere else.
 *
 * **Nothing here may ever be driven by observed state.** Playing this off "a
 * body appeared" or "a player's `alive` flipped" would make it fire for
 * bystanders and turn a private cutscene into a public one. The secrecy
 * property is that no third party receives a message at all — see
 * `server/src/rooms/GameRoomKillSecrecy.test.ts`, which asserts that on the
 * content, timing and packet-size channels rather than trusting this comment.
 *
 * This module also sends nothing and requests nothing. It is a pure consumer
 * of a message that already existed before 7.9, so it cannot widen the kill
 * window's network footprint by construction.
 */

/** §10.1's five beats, in order. Sum: 1380ms — "roughly 1.4s". */
export const KILL_BEATS = {
  /** 1. Fog surges inward, world darkens to near black except the two lanterns. */
  fogSurgeMs: 300,
  /** 2. Hit-stop. Everything freezes. */
  hitStopMs: 80,
  /** 3. The angular ink splatter. */
  splatterMs: 200,
  /** 4. Victim's lantern detaches, falls, bounces, rolls, glow fades. */
  lanternMs: 600,
  /** 5. Fog releases, world returns. */
  releaseMs: 200,
} as const;

export const KILL_CUTSCENE_TOTAL_MS =
  KILL_BEATS.fogSurgeMs +
  KILL_BEATS.hitStopMs +
  KILL_BEATS.splatterMs +
  KILL_BEATS.lanternMs +
  KILL_BEATS.releaseMs;

/** Beat 1's target: "near black", not black — the two lanterns must still read. */
export const KILL_VIGNETTE_PEAK = 0.92;

/** Where each beat starts, measured from t=0. Derived so the beats cannot drift apart. */
export const KILL_BEAT_START = {
  fogSurge: 0,
  hitStop: KILL_BEATS.fogSurgeMs,
  splatter: KILL_BEATS.fogSurgeMs + KILL_BEATS.hitStopMs,
  lantern: KILL_BEATS.fogSurgeMs + KILL_BEATS.hitStopMs + KILL_BEATS.splatterMs,
  release:
    KILL_BEATS.fogSurgeMs +
    KILL_BEATS.hitStopMs +
    KILL_BEATS.splatterMs +
    KILL_BEATS.lanternMs,
} as const;

const SPLATTER_DEPTH = 45;
const SPLATTER_BASE_SCALE = 0.55;

export interface KillCutsceneTarget {
  /** Where the victim fell, in world coordinates. */
  x: number;
  y: number;
}

export interface KillCutsceneHandle {
  /** Cancels every pending beat. Idempotent; safe after natural completion. */
  cancel(): void;
}

/**
 * Plays the five beats. Returns a handle so `GameScene.teardown` can cancel a
 * cutscene still in flight — a timer surviving its scene would fire against
 * destroyed game objects.
 *
 * `stampsSoFar` only picks which pre-baked splatter shape is used, so repeat
 * kills in one round don't stamp the identical silhouette.
 */
export function playKillCutscene(
  scene: Phaser.Scene,
  at: KillCutsceneTarget,
  stampsSoFar: number,
): KillCutsceneHandle {
  buildSplatterTextures(scene);

  const timers: Phaser.Time.TimerEvent[] = [];
  const spawned: Phaser.GameObjects.GameObject[] = [];
  let cancelled = false;

  const at_ = (delay: number, run: () => void) => {
    timers.push(scene.time.delayedCall(delay, () => {
      if (!cancelled) {
        run();
      }
    }));
  };

  // --- Beat 1 (0ms, 300ms) — fog surges inward, world darkens to near black.
  //
  // Routed through the juice director's vignette rather than drawn here, for
  // the §9 reason: it is the same screen-level effect the sabotage and
  // body-discovered beats use, and an effect that bypasses the director also
  // bypasses the reduced-motion setting.
  juice.vignette(KILL_VIGNETTE_PEAK, KILL_BEATS.fogSurgeMs);

  // --- Beat 2 (300ms, 80ms) — hit-stop.
  //
  // The director's `hitStop` freezes rendering only; input, prediction and the
  // send loop keep running (see `JuiceDirector`). A cutscene must never be
  // able to desync the player who is watching it.
  at_(KILL_BEAT_START.hitStop, () => {
    juice.hitStop(KILL_BEATS.hitStopMs);
  });

  // --- Beat 3 (380ms, 200ms) — the angular ink splatter.
  at_(KILL_BEAT_START.splatter, () => {
    const splatter = scene.add
      .image(at.x, at.y, splatterKeyFor(stampsSoFar))
      .setDepth(SPLATTER_DEPTH)
      .setScale(SPLATTER_BASE_SCALE * 0.7)
      .setAlpha(0);
    spawned.push(splatter);

    // Snaps to full in the first third, then holds — a splash lands, it does
    // not ease in. `Back.easeOut` gives the stamp a hard arrival without any
    // curve appearing in the artwork itself.
    scene.tweens.add({
      targets: splatter,
      alpha: 1,
      scale: SPLATTER_BASE_SCALE,
      duration: Math.round(KILL_BEATS.splatterMs / 3),
      ease: "Back.easeOut",
    });
  });

  // --- Beat 4 (580ms, 600ms) — the lantern detaches, falls, bounces, rolls,
  // glow fades. §10.1: "That last sound is the whole scene."
  //
  // The rig already owns this motion (`Havener.playDeath`, built in 7.6). It
  // is deliberately NOT re-implemented here — this beat's job is to reserve
  // the 600ms the rig needs and to keep the vignette closed over it, so the
  // fall is the only thing on screen.
  at_(KILL_BEAT_START.lantern, () => {
    // Holds the darkness flat across the fall rather than re-triggering it,
    // so the lantern's own glow is the brightest thing in frame.
    juice.vignette(KILL_VIGNETTE_PEAK, 0);
  });

  // --- Beat 5 (1180ms, 200ms) — fog releases, world returns.
  at_(KILL_BEAT_START.release, () => {
    juice.vignette(VIGNETTE_BASE_INTENSITY, KILL_BEATS.releaseMs);
    for (const object of spawned) {
      scene.tweens.add({
        targets: object,
        alpha: 0,
        duration: KILL_BEATS.releaseMs,
        onComplete: () => object.destroy(),
      });
    }
  });

  return {
    cancel(): void {
      if (cancelled) {
        return;
      }
      cancelled = true;
      for (const timer of timers) {
        timer.remove(false);
      }
      for (const object of spawned) {
        object.destroy();
      }
      spawned.length = 0;
    },
  };
}
