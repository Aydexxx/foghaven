interface AbilityHintToastProps {
  text: string | null;
}

/**
 * A transient banner for the private, structured facts an ability hands
 * back (the detective's witness, the medium's commune) — the server sends
 * only data, this is where it becomes a sentence. Renders nothing when
 * there's no current hint; `GameView` clears the text again after a short
 * delay, which is what makes it "transient" rather than a persistent log.
 */
export function AbilityHintToast({ text }: AbilityHintToastProps) {
  if (!text) {
    return null;
  }
  return (
    <div className="ability-hint-toast" role="status">
      {text}
    </div>
  );
}
