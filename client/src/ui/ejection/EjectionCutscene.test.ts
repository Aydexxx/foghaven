import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const COMPONENT = fileURLToPath(new URL("./EjectionCutscene.tsx", import.meta.url));
const MEETING_SCREEN = fileURLToPath(new URL("../MeetingScreen.tsx", import.meta.url));

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * "Skipping is per-client: one player skipping must not affect what anyone
 * else sees." The component-level guarantee for that is structural — the
 * component takes no `room` and no network callback, so there is nothing IN
 * SCOPE for a skip handler to call even by accident. Asserted here rather
 * than left as a comment, the same reasoning as `juice/noAdHocEffects.test.ts`
 * and `game/cutscenes/killCutscene.test.ts`'s trigger-surface tests: a rule
 * that only lives in prose survives exactly until someone "helpfully" wires
 * a room reference through for some unrelated reason.
 */
describe("§10.2 ejection cutscene never reaches the network", () => {
  it("sends nothing and holds no Colyseus room reference", () => {
    const source = code(COMPONENT);
    expect(source).not.toContain(".send(");
    expect(source).not.toMatch(/\broom\b/);
    expect(source).not.toContain("colyseus");
  });

  it("is mounted with no room or send-capable prop", () => {
    const source = code(MEETING_SCREEN);
    const start = source.indexOf("<EjectionCutscene");
    expect(start, "EjectionCutscene is no longer mounted in MeetingScreen").toBeGreaterThan(-1);
    const end = source.indexOf("/>", start);
    const propsText = source.slice(start, end);
    expect(propsText).not.toContain("room=");
    expect(propsText).not.toContain("onVote");
    expect(propsText).not.toContain("send");
  });

  it("only listens for input, never sends it anywhere but back into its own local state", () => {
    const source = code(COMPONENT);
    // The skip handler is the one place this component reacts to input at
    // all — pin that its only effect is a local `setElapsedMs`/ref write.
    const listenerCalls = source.match(/addEventListener\("(keydown|pointerdown)",\s*(\w+)\)/g) ?? [];
    expect(listenerCalls.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("setElapsedMs(EJECTION_CUTSCENE_TOTAL_MS)");
  });
});
