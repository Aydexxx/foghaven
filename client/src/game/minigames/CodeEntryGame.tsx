import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MinigameProps } from "./types";

const CODE_LENGTH = 4;
const KEYPAD_DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

function randomCode(length: number): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}

/**
 * Keypad entry: the correct code is shown on screen, and the player must
 * type it back digit-for-digit. The challenge is careful input, not memory —
 * that's `PatternMemoryGame`'s job.
 */
export function CodeEntryGame({ onComplete }: MinigameProps) {
  const { t } = useTranslation();
  const code = useMemo(() => randomCode(CODE_LENGTH), []);
  const [entered, setEntered] = useState("");
  const [shake, setShake] = useState(false);

  const press = (digit: string) => {
    if (shake) {
      return;
    }
    const next = entered + digit;
    setEntered(next);

    if (next.length === CODE_LENGTH) {
      if (next === code) {
        onComplete();
      } else {
        setShake(true);
        setTimeout(() => {
          setEntered("");
          setShake(false);
        }, 500);
      }
    }
  };

  const backspace = () => setEntered((prev) => prev.slice(0, -1));

  return (
    <div className="minigame minigame-code" data-minigame="code">
      <p className="minigame-instructions">{t("minigame.code.instructions")}</p>

      <div className="code-display">
        {code.split("").map((digit, i) => (
          <span key={i} className="code-digit">
            {digit}
          </span>
        ))}
      </div>

      <div className={`code-entry ${shake ? "code-entry-error" : ""}`}>
        {Array.from({ length: CODE_LENGTH }).map((_, i) => (
          <span key={i} className="code-entry-slot">
            {entered[i] ?? ""}
          </span>
        ))}
      </div>

      <div className="keypad">
        {KEYPAD_DIGITS.map((key, i) => {
          if (key === "") {
            return <span key={i} />;
          }
          if (key === "⌫") {
            return (
              <button key={i} type="button" className="keypad-key" onClick={backspace}>
                {key}
              </button>
            );
          }
          return (
            <button key={i} type="button" className="keypad-key" onClick={() => press(key)}>
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
