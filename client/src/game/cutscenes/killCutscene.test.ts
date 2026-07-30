import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  KILL_BEATS,
  KILL_BEAT_START,
  KILL_CUTSCENE_TOTAL_MS,
  KILL_VIGNETTE_PEAK,
} from "./killCutscene";
import { SPLATTER_VARIANTS, splatterKeyFor } from "./bloodSplatter";

/**
 * Comments are stripped before any source assertion below, for the same reason
 * `juice/noAdHocEffects.test.ts` does it: the doc comment explaining that this
 * file draws no curves necessarily names the curve functions, and a guard that
 * cannot tell prose from code punishes the comments most worth writing.
 */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

const GAME_SCENE = fileURLToPath(new URL("../GameScene.ts", import.meta.url));
const CUTSCENE = fileURLToPath(new URL("./killCutscene.ts", import.meta.url));
const SPLATTER = fileURLToPath(new URL("./bloodSplatter.ts", import.meta.url));

describe("§10.1 kill timeline", () => {
  it("is five beats totalling roughly 1.4s", () => {
    expect(Object.keys(KILL_BEATS)).toHaveLength(5);
    expect(KILL_CUTSCENE_TOTAL_MS).toBe(1380);
    // "roughly 1.4 s" — within 100ms either side.
    expect(Math.abs(KILL_CUTSCENE_TOTAL_MS - 1400)).toBeLessThanOrEqual(100);
  });

  it("matches §10.1's per-beat durations exactly", () => {
    expect(KILL_BEATS.fogSurgeMs).toBe(300);
    expect(KILL_BEATS.hitStopMs).toBe(80);
    expect(KILL_BEATS.splatterMs).toBe(200);
    expect(KILL_BEATS.lanternMs).toBe(600);
    expect(KILL_BEATS.releaseMs).toBe(200);
  });

  it("orders the beats without gaps or overlaps", () => {
    // Each beat starts exactly where the previous one ended — this is what
    // makes it a timeline rather than five independent effects that happen to
    // be scheduled near each other.
    expect(KILL_BEAT_START.fogSurge).toBe(0);
    expect(KILL_BEAT_START.hitStop).toBe(KILL_BEATS.fogSurgeMs);
    expect(KILL_BEAT_START.splatter).toBe(KILL_BEAT_START.hitStop + KILL_BEATS.hitStopMs);
    expect(KILL_BEAT_START.lantern).toBe(KILL_BEAT_START.splatter + KILL_BEATS.splatterMs);
    expect(KILL_BEAT_START.release).toBe(KILL_BEAT_START.lantern + KILL_BEATS.lanternMs);
    expect(KILL_BEAT_START.release + KILL_BEATS.releaseMs).toBe(KILL_CUTSCENE_TOTAL_MS);
  });

  it("darkens to near black, not to black — the two lanterns must still read", () => {
    expect(KILL_VIGNETTE_PEAK).toBeGreaterThan(0.8);
    expect(KILL_VIGNETTE_PEAK).toBeLessThan(1);
  });
});

describe("§10.1 blood splatter is a sprite, not a particle system", () => {
  it("bakes several fixed variants so repeat kills differ without randomising", () => {
    expect(SPLATTER_VARIANTS).toBeGreaterThan(1);
    // Deterministic per index, and cycling.
    expect(splatterKeyFor(0)).toBe(splatterKeyFor(SPLATTER_VARIANTS));
    expect(splatterKeyFor(0)).not.toBe(splatterKeyFor(1));
    // Negative indices must not produce a broken key.
    expect(splatterKeyFor(-1)).toMatch(/kill-splatter-\d+$/);
  });

  it("draws only straight segments — §2 rule 4 reserves hard angles for danger", () => {
    const source = code(SPLATTER);
    // A curve anywhere in the splatter geometry would put it back in the soft,
    // "safe" shape language the art bible reserves for characters and props.
    for (const curve of ["quadraticCurveTo", "bezierCurveTo", "arcTo", "ellipse("]) {
      expect(source, `${curve} would round the splatter's corners`).not.toContain(curve);
    }
    // `arc(` is checked separately from `arcTo` so neither name masks the other.
    expect(source).not.toMatch(/\bctx\.arc\(/);
    expect(source).toContain("lineTo");
  });

  it("uses no particle emitter", () => {
    const source = code(SPLATTER) + code(CUTSCENE);
    expect(source).not.toContain("add.particles");
    expect(source).not.toContain("ParticleEmitter");
  });

  it("uses only §3 palette tokens, never a raw hex", () => {
    const source = code(SPLATTER);
    // §2 rule 5, palette lock. Matches a literal colour anywhere in the file.
    const rawHex = source.match(/["'`]#[0-9a-fA-F]{3,8}["'`]/g);
    expect(rawHex, `raw hex literals found: ${JSON.stringify(rawHex)}`).toBeNull();
    expect(source).toContain("colors.bloodDeep");
    expect(source).toContain("colors.bloodBright");
    expect(source).toContain("colors.ink");
  });
});

describe("the cutscene's trigger surface stays private", () => {
  /**
   * The security property lives on the server (see
   * `GameRoomKillSecrecy.test.ts`), but it is only preserved if the client
   * keeps triggering off the two private messages. The realistic regression is
   * someone "improving" this by playing it when a body appears or when a
   * player's `alive` flag flips — both of which fire for bystanders and would
   * silently turn a two-person cutscene into a public one.
   */
  it("starts the cutscene only from the killed/killConfirmed messages", () => {
    const source = code(GAME_SCENE);
    const callSites = source.match(/startKillCutscene\(/g) ?? [];
    // One definition plus the two message handlers' shared helper.
    expect(callSites.length).toBeLessThanOrEqual(3);

    // The handler binding must name both private messages and nothing else.
    expect(source).toContain('this.room.onMessage("killed"');
    expect(source).toContain('this.room.onMessage("killConfirmed"');
  });

  it("never reaches the cutscene from body or aliveness observation", () => {
    const source = code(GAME_SCENE);
    // Isolate the two methods that run for bystanders and assert neither one
    // plays the cutscene.
    for (const method of ["private addBody(", "private onPlayerConfirmedDead("]) {
      const start = source.indexOf(method);
      expect(start, `${method} not found — test needs updating`).toBeGreaterThan(-1);
      // Bounded by the NEXT method rather than by a character count — a fixed
      // window silently spills into whatever follows and starts asserting
      // about unrelated code.
      const rest = source.slice(start + method.length);
      const next = rest.search(/\n {2}(?:private|public|override|get|set)\s/);
      const body = next === -1 ? rest : rest.slice(0, next);
      expect(
        body,
        `${method} must not start the kill cutscene — it runs for third parties`,
      ).not.toContain("startKillCutscene");
    }
  });

  it("sends nothing to the server", () => {
    const source = code(CUTSCENE) + code(SPLATTER);
    // A cutscene that talked back would add traffic to the kill window and
    // reopen the timing channel the server tests just closed.
    expect(source).not.toContain(".send(");
    expect(source).not.toContain("room.");
  });
});
