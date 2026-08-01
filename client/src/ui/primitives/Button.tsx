import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "default" | "primary" | "destructive" | "link";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

/**
 * ART_BIBLE §8 Button. A real `<button>` — the global 1.0→1.06→1.0 scale
 * punch on press (§9's "Any button press" row) is already delegated to every
 * `<button>` in the document by `useButtonJuice`, so nothing here needs to
 * touch JuiceDirector. This component only adds its own static press
 * affordance: a 5px solid ink bar under the body (faked with `box-shadow`,
 * no extra DOM node) that collapses to 0 and translates the button down 5px
 * over 60ms on `:active`. That's the whole "fake thickness" trick from §8,
 * done in two CSS rules — see `primitives.css`.
 *
 * `data-no-juice` and any other native button prop pass straight through, so
 * call sites that opt out of the delegated punch for their own stronger
 * juice event (e.g. `MeetingScreen`'s Skip button, which gets the same
 * "vote cast" punch a `PlayerVoteCard` does on selection) keep working
 * unchanged.
 */
export function Button({ variant = "default", className, type = "button", ...rest }: ButtonProps) {
  const classes = ["ph-button", `ph-button--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
