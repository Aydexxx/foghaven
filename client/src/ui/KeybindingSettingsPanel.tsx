import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInputSettings } from "../input/useInputSettings";
import type { InputAction } from "../input/inputEngine";

interface KeybindingSettingsPanelProps {
  onClose: () => void;
}

const ACTIONS: InputAction[] = ["moveUp", "moveDown", "moveLeft", "moveRight", "interact", "report", "bell"];

/**
 * Rebind any of the seven keyboard actions. Only single-letter keys are
 * accepted — the arrow keys are deliberately not offered as a rebind target
 * since they already work unconditionally as movement's fixed alternate
 * (see `GameScene.ts`'s `sampleInput`), and every other action here is a
 * plain letter by design. Writes straight through `inputEngine`, which
 * `GameScene` live-rebinds from — same "no separate apply step" shape as
 * `GraphicsSettingsPanel`/`AudioSettingsPanel`.
 */
export function KeybindingSettingsPanel({ onClose }: KeybindingSettingsPanelProps) {
  const { t } = useTranslation();
  const { settings, setBinding, resetToDefaults } = useInputSettings();
  const [listeningFor, setListeningFor] = useState<InputAction | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!listeningFor) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        setListeningFor(null);
        return;
      }
      const letter = /^[a-zA-Z]$/.test(e.key) ? e.key.toUpperCase() : null;
      if (!letter) {
        return;
      }
      const collidesWith = ACTIONS.find((action) => action !== listeningFor && settings[action] === letter);
      if (collidesWith) {
        setConflict(t("keybindingSettings.conflict", { key: letter }));
        return;
      }
      setConflict(null);
      setBinding(listeningFor, letter);
      setListeningFor(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [listeningFor, settings, setBinding, t]);

  return (
    <div className="audio-settings-overlay" role="dialog" aria-label={t("keybindingSettings.heading")}>
      <div className="audio-settings-panel">
        <h2>{t("keybindingSettings.heading")}</h2>

        {ACTIONS.map((action) => (
          <div className="audio-settings-row" key={action}>
            <label className="audio-settings-label">{t(`keybindingSettings.actions.${action}`)}</label>
            <span />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setConflict(null);
                setListeningFor(action);
              }}
            >
              {listeningFor === action ? t("keybindingSettings.pressAKey") : settings[action]}
            </button>
          </div>
        ))}

        {conflict && <p className="hint">{conflict}</p>}
        <p className="hint">{t("keybindingSettings.hint")}</p>

        <button type="button" className="secondary" onClick={resetToDefaults}>
          {t("keybindingSettings.resetButton")}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          {t("keybindingSettings.closeButton")}
        </button>
      </div>
    </div>
  );
}
