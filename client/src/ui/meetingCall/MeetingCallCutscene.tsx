import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { audioEngine } from "../../audio/audioEngine";
import { graphicsEngine } from "../../graphics/graphicsEngine";
import {
  MEETING_CALL_BEAT_START,
  MEETING_CALL_TOTAL_MS,
  meetingCallBeatAt,
  meetingCallTitle,
  ringPosition,
} from "./meetingCallTimeline";

interface MeetingCallCutsceneProps {
  isEmergency: boolean;
  /** The reporter/caller's name — the emergency variant's header. */
  callerName: string;
  /** Already resolved to a display string (`t(\`rooms.${slug}\`)`) — empty for an emergency. */
  bodyRoomName: string;
  /** Every currently-living player's lantern hex, for the ring. */
  livingLanternColors: string[];
}

/**
 * ART_BIBLE §10.3: every player's lantern flares to full brightness against
 * black, arranged in a ring; the bell tolls; the title slams in; the
 * discussion UI slides up from below. One timeline, two variants — the
 * header names the room for a body report, or the caller for an emergency.
 *
 * ## Why this is safe to render on top of the REAL discussion UI
 *
 * "The transition into the discussion UI must be continuous. No flash of
 * unstyled content, no gap, no jump cut." The only way to guarantee that in
 * React is to never have the discussion UI NOT be there: `MeetingScreen`
 * renders its normal DISCUSSION content unconditionally, and this component
 * is mounted as a sibling on top of it (see `MeetingScreen`'s render), fully
 * opaque, covering it completely for beats `ring`/`bell`/`title`. The final
 * `slide` beat doesn't animate the discussion UI in from anywhere — it
 * animates THIS overlay up and off-screen, uncovering content that was
 * already laid out, already styled, and already live underneath the whole
 * time. There is nothing to flash, no gap to open, and no cut to jump,
 * because nothing about the real UI's mount timing ever depended on this
 * component at all.
 *
 * Once the sequence reaches its `"done"` state this renders `null` — not
 * just visually cleared but gone, so a `pointer-events` slip can never leave
 * an invisible full-screen layer sitting over the chat panel for the rest of
 * discussion.
 */
export function MeetingCallCutscene({
  isEmergency,
  callerName,
  bodyRoomName,
  livingLanternColors,
}: MeetingCallCutsceneProps) {
  const { t } = useTranslation();
  const startRef = useRef(performance.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const playedBellRef = useRef(false);

  useEffect(() => {
    // The ring-flare beat's own cue — see `stingers.ts`: "a long metallic
    // bell swell", fired once at mount, exactly the ring beat's start.
    audioEngine.playStinger("meetingStart");

    const interval = setInterval(() => {
      const next = performance.now() - startRef.current;
      setElapsedMs(next);
      if (next >= MEETING_CALL_TOTAL_MS) {
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
    // No dependencies beyond mount — `MeetingScreen` only ever mounts this
    // once per meeting (see its own render, gated on entering DISCUSSION).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beat = meetingCallBeatAt(elapsedMs);

  // The toll fires exactly once, the instant elapsed time crosses into the
  // "bell" beat. §10.3: "The bell tolls" is a single, specific beat — not
  // the ring-flare's own swell, which is a different stinger entirely (see
  // `playBellTollStinger`'s doc on how the two are meant to differ).
  useEffect(() => {
    if (!playedBellRef.current && elapsedMs >= MEETING_CALL_BEAT_START.bell) {
      playedBellRef.current = true;
      audioEngine.playStinger("bellToll");
    }
  }, [elapsedMs]);

  if (beat === "done") {
    return null;
  }

  const reduced = graphicsEngine.prefersReducedMotion();
  const { titleKey, titleParams } = meetingCallTitle(isEmergency, callerName, bodyRoomName);

  return (
    <div
      className={`meeting-call-cutscene meeting-call-beat-${beat}${reduced ? " meeting-call-reduced-motion" : ""}`}
      data-meeting-call-cutscene
    >
      <div className="meeting-call-ring">
        {livingLanternColors.map((hex, index) => {
          const { xPercent, yPercent } = ringPosition(index, livingLanternColors.length);
          return (
            <span
              key={index}
              className="meeting-call-lantern"
              style={{ left: `${xPercent}%`, top: `${yPercent}%`, background: hex, boxShadow: `0 0 10px 3px ${hex}` }}
            />
          );
        })}
      </div>

      {(beat === "title" || beat === "slide") && (
        <h1 className="meeting-call-title">{t(titleKey, titleParams)}</h1>
      )}
    </div>
  );
}
