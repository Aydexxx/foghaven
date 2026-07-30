import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The architectural half of ART_BIBLE §9, enforced rather than documented.
 *
 * "No ad-hoc camera calls or one-off tweens scattered through gameplay code —
 * if something shakes the screen and doesn't go through JuiceDirector, that's
 * a bug." That rule decays the moment it is only a comment: the next person
 * adding a beat reaches for `this.cameras.main.shake()` because it is one
 * line and it works, and the reduced-motion setting silently stops covering
 * the whole game.
 *
 * A grep test is unusual, but the invariant is genuinely lexical — there is
 * no type signature that can express "this method exists but only one module
 * may call it". Catching it here costs a second; catching it in review
 * depends on someone remembering.
 */

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The juice module is the one place allowed to touch these. */
const ALLOWED_DIR = join(SRC, "juice");

const FORBIDDEN: Array<{ pattern: RegExp; what: string; instead: string }> = [
  {
    pattern: /cameras\s*\.\s*main\s*\.\s*shake\s*\(/,
    what: "a direct Phaser camera shake",
    instead: "juice.shake(px, ms) / juiceEvents",
  },
  {
    pattern: /cameras\s*\.\s*main\s*\.\s*flash\s*\(/,
    what: "a direct Phaser camera flash",
    instead: "juice.flash(color, alpha, ms) / juiceEvents",
  },
  {
    pattern: /\.\s*setTimeScale\s*\(\s*0\s*\)/,
    what: "an ad-hoc time-scale freeze",
    instead: "juice.hitStop(ms)",
  },
  {
    pattern: /tweens\s*\.\s*(pauseAll|resumeAll)\s*\(/,
    what: "a global tween pause outside the hit-stop system",
    instead: "juice.hitStop(ms)",
  },
];

/**
 * Comments are stripped before scanning. Without this the test fires on its
 * own documentation — `PhaseAtmosphere`'s note explaining that it *used to*
 * call the camera directly reads identically to the call itself. Prose about
 * a forbidden call is not a forbidden call, and a guard that cannot tell the
 * difference punishes exactly the comments most worth writing.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("§9 — every screen effect routes through JuiceDirector", () => {
  const files = walk(SRC).filter((file) => !file.startsWith(ALLOWED_DIR + sep));

  it("finds source files to check (guards against the walker silently matching nothing)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { pattern, what, instead } of FORBIDDEN) {
    it(`has no ${what} outside client/src/juice/`, () => {
      const offenders = files
        .filter((file) => pattern.test(stripComments(readFileSync(file, "utf8"))))
        .map((file) => relative(SRC, file));

      expect(
        offenders,
        offenders.length === 0
          ? ""
          : `${what} found outside the juice module. Use ${instead} instead — ` +
            `effects that bypass the director also bypass the reduced-motion setting.`,
      ).toEqual([]);
    });
  }
});
