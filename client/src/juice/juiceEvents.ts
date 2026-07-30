import { colors, duration } from "../theme/tokens";
import { juice, VIGNETTE_BASE_INTENSITY, VIGNETTE_CRITICAL_INTENSITY } from "./JuiceDirector";

/**
 * ART_BIBLE §9's effect table, one exported function per row.
 *
 * Gameplay code calls `juiceEvents.kill()`, never `juice.hitStop(80)` — the
 * primitives in `JuiceDirector` are the vocabulary, and this file is the
 * script. Two reasons that separation is worth a file of its own:
 *
 *  1. The §9 numbers live in exactly one place. When the art bible's kill
 *     timing changes, it changes here, not in whichever call site happened to
 *     hard-code 80/8/250/0.4 first.
 *  2. It makes "does every §9 row actually route through the director?" a
 *     question you can answer by reading one file, instead of by grepping the
 *     whole client for camera calls and hoping.
 *
 * ---
 *
 * ## Rows not yet wired here
 *
 * Three §9 rows are deliberately absent, because their effect is a *cutscene*
 * rather than a screen effect and the assets and sequencing belong to later
 * tasks:
 *
 *  - **Meeting called** (full-screen wipe, bell toll, all lanterns flare) —
 *    §10.3, roadmap 7.10.
 *  - **Ejection** — §9 itself defers this ("See §10"); roadmap 7.9/7.10.
 *  - **Round end** (losing side's lanterns extinguish 80 ms apart) —
 *    roadmap 7.11.
 *
 * When those land they must be built from these primitives too. The
 * `LANTERN_EXTINGUISH_STAGGER_MS` constant below is exported now so the round
 * end screen has one obvious place to take the number from rather than
 * inventing its own.
 */

// --- §9 constants, verbatim from the table ---------------------------------

/** "Scale 1.0 → 1.06 → 1.0 over 120 ms, `back.out` easing" */
export const BUTTON_PUNCH_SCALE = 1.06;
export const BUTTON_PUNCH_MS = duration.base;

/** "Kill | Hit-stop 80 ms → screen shake 8 px decaying over 250 ms → `bloodBright` flash at 40% for 100 ms" */
export const KILL_HIT_STOP_MS = 80;
export const KILL_SHAKE_PX = 8;
export const KILL_SHAKE_MS = 250;
export const KILL_FLASH_ALPHA = 0.4;
export const KILL_FLASH_MS = 100;

/** "Body discovered | Hit-stop 120 ms, camera snaps to body, vignette hard-closes" */
export const BODY_HIT_STOP_MS = 120;
export const BODY_VIGNETTE_INTENSITY = 0.7;
/** "Hard-closes" — fast enough to read as a snap, not a fade. */
export const BODY_VIGNETTE_CLOSE_MS = duration.fast;
export const BODY_VIGNETTE_REOPEN_MS = duration.slow;

/** "Task progress bar advances | Never jumps. Always tweens over 400 ms." */
export const TASK_PROGRESS_TWEEN_MS = 400;

/** "Vote cast | Card punches, a `voteGold` pip drops in with a bounce" */
export const VOTE_PUNCH_SCALE = 1.08;
export const VOTE_PUNCH_MS = duration.base;

/** "Sabotage triggered | Screen edges pulse `strangerRed` at 1.5 Hz until resolved" */
export const SABOTAGE_PULSE_HZ = 1.5;

/** "Round end | Losing side's lanterns all extinguish one by one, 80 ms apart" */
export const LANTERN_EXTINGUISH_STAGGER_MS = 80;

/** Task complete: the progress bar's own acknowledgement pulse. */
export const TASK_COMPLETE_PUNCH_SCALE = 1.05;
export const TASK_COMPLETE_PUNCH_MS = duration.base;

// --- Sequencing ------------------------------------------------------------

/**
 * Schedules a follow-up beat on real wall-clock time.
 *
 * Guarded rather than calling `window.setTimeout` directly so this module
 * stays importable outside a browser — it is pulled in by `GameScene`, by
 * React, and by tests, and a bare `window` reference would make importing it
 * in a node test a crash rather than a no-op.
 *
 * Wall-clock, deliberately: a beat scheduled here must land at the same
 * offset for every player, including one whose amplitudes are zeroed by
 * reduced motion and one running at half the frame rate.
 */
function after(ms: number, run: () => void): void {
  if (typeof window === "undefined") {
    return;
  }
  window.setTimeout(run, ms);
}

// --- Rows ------------------------------------------------------------------

/**
 * Any button press. Takes the element because §9's punch is on the button
 * itself, not the screen — call it from the handler, not from a global click
 * listener, so a press that does nothing doesn't get a confirmation animation.
 */
export function buttonPress(target: HTMLElement | null | undefined): void {
  if (target) {
    juice.punch(target, BUTTON_PUNCH_SCALE, BUTTON_PUNCH_MS);
  }
}

/**
 * A kill, from either side of it. The three beats are sequenced on real
 * wall-clock time rather than nested inside the hit-stop, so the whole
 * sequence lasts the same 430 ms for every player regardless of frame rate or
 * of whether reduced motion has zeroed the two visible beats.
 */
export function kill(): void {
  juice.hitStop(KILL_HIT_STOP_MS);
  after(KILL_HIT_STOP_MS, () => {
    juice.shake(KILL_SHAKE_PX, KILL_SHAKE_MS);
    juice.flash(colors.bloodBright, KILL_FLASH_ALPHA, KILL_FLASH_MS);
  });
}

/**
 * A body discovered. The vignette hard-closes and then reopens to whatever
 * the standing level is — passed in rather than assumed, because a body found
 * *during* a critical sabotage has to return to 55%, not to the 25% baseline.
 */
export function bodyDiscovered(standingVignette = VIGNETTE_BASE_INTENSITY): void {
  juice.hitStop(BODY_HIT_STOP_MS);
  juice.vignette(BODY_VIGNETTE_INTENSITY, BODY_VIGNETTE_CLOSE_MS);
  after(BODY_HIT_STOP_MS, () => {
    juice.vignette(standingVignette, BODY_VIGNETTE_REOPEN_MS);
  });
}

/** A vote being cast — the card punches. The pip drop is the caller's own CSS. */
export function voteCast(card: HTMLElement | null | undefined): void {
  if (card) {
    juice.punch(card, VOTE_PUNCH_SCALE, VOTE_PUNCH_MS);
  }
}

/** A task completing — the progress bar acknowledges before it disappears. */
export function taskComplete(bar: HTMLElement | null | undefined): void {
  if (bar) {
    juice.punch(bar, TASK_COMPLETE_PUNCH_SCALE, TASK_COMPLETE_PUNCH_MS);
  }
}

/**
 * Sabotage running or resolved. Drives both §9 sabotage behaviours together —
 * the edge pulse and the vignette's rise to 55% — because they resolve on the
 * same event and splitting them across two call sites is how one of them ends
 * up stuck on after the other clears.
 */
export function setSabotageActive(active: boolean): void {
  if (active) {
    juice.edgePulse(colors.strangerRed, SABOTAGE_PULSE_HZ);
    juice.vignette(VIGNETTE_CRITICAL_INTENSITY, duration.slow);
    return;
  }
  juice.edgePulse(null);
  juice.vignette(VIGNETTE_BASE_INTENSITY, duration.slow);
}

/** The §9 persistent vignette, raised on entering the world. */
export function enterWorld(): void {
  juice.vignette(VIGNETTE_BASE_INTENSITY, duration.slow);
}

/** Leaving the world — clears every standing effect. */
export function leaveWorld(): void {
  juice.reset();
}
