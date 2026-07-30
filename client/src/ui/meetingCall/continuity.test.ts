import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MEETING_SCREEN = fileURLToPath(new URL("../MeetingScreen.tsx", import.meta.url));

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * "The transition into the discussion UI must be continuous. No flash of
 * unstyled content, no gap, no jump cut." The only way this is actually true
 * in React is structural: the real DISCUSSION content must be rendered
 * UNCONDITIONALLY whenever the stage is DISCUSSION, with `MeetingCallCutscene`
 * mounted as a sibling overlay on top of it — never as a wrapper the
 * discussion content waits behind, and never gated on the cutscene's own
 * "am I done" state.
 *
 * The realistic regression this guards against: someone "cleans up" by only
 * rendering the discussion content once the cutscene reports completion (an
 * `onComplete` callback, a `cutsceneDone` boolean) — which looks tidier and
 * quietly reintroduces exactly the gap/jump-cut this requirement forbids. A
 * grep can't verify the pixels are continuous, but it can verify the ONE
 * structural precondition that makes continuity possible at all.
 */
describe("§10.3 meeting call cannot gap the discussion UI", () => {
  const source = code(MEETING_SCREEN);

  it("renders MeetingCallCutscene and the DISCUSSION content as siblings, not nested", () => {
    const cutsceneStart = source.indexOf("<MeetingCallCutscene");
    expect(cutsceneStart, "MeetingCallCutscene is no longer rendered").toBeGreaterThan(-1);
    const cutsceneEnd = source.indexOf("/>", cutsceneStart);

    const discussionStart = source.indexOf("MEETING_STAGE.DISCUSSION &&");
    expect(discussionStart, "the DISCUSSION-stage block is no longer found").toBeGreaterThan(-1);

    // The cutscene's own JSX element must not be INSIDE the discussion
    // block's braces — i.e. the discussion content's opening must not fall
    // between the cutscene's own start and end tags (which would mean the
    // cutscene wraps the discussion content rather than sitting beside it).
    const nested = discussionStart > cutsceneStart && discussionStart < cutsceneEnd;
    expect(nested, "MeetingCallCutscene must not wrap the DISCUSSION content").toBe(false);
  });

  it("has no lifted 'cutscene done' state gating the discussion content", () => {
    // If a completion callback or done-flag existed, it would need a name —
    // none of these should appear anywhere in this file.
    for (const forbidden of ["onComplete", "cutsceneDone", "callPlaying", "showDiscussion"]) {
      expect(source, `found "${forbidden}" — the discussion content must never wait on the cutscene`).not.toContain(
        forbidden,
      );
    }
  });

  it("keeps the DISCUSSION block's own condition independent of any cutscene prop", () => {
    // The discussion content's gate must be the server's stage alone.
    const discussionGate = source.match(/\{snapshot\.stage === MEETING_STAGE\.DISCUSSION[^}]*&&/);
    expect(discussionGate, "could not find the discussion block's condition").not.toBeNull();
    expect(discussionGate![0]).not.toMatch(/cutscene|MeetingCall/i);
  });
});
