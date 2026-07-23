interface OnboardingHintToastProps {
  text: string | null;
}

/**
 * Renders a `useOnboardingHint` result. Visually similar to
 * `AbilityHintToast` but a distinct class/position (top rather than bottom)
 * so the two never overlap if a role's ability hint and a first-time hint
 * ever land in the same moment.
 */
export function OnboardingHintToast({ text }: OnboardingHintToastProps) {
  if (!text) {
    return null;
  }
  return (
    <div className="onboarding-hint-toast" role="status">
      {text}
    </div>
  );
}
