import { useTranslation } from "react-i18next";
import { useGraphicsSettings } from "../graphics/useGraphicsSettings";
import type { MotionPreference } from "../graphics/graphicsEngine";

interface GraphicsSettingsPanelProps {
  onClose: () => void;
}

/**
 * The one graphics toggle — atmosphere effects (colour grade, light bleed,
 * particles, puddle shimmer, screen shake) on or off. Writes straight
 * through `graphicsEngine`, which applies it live (`PhaseAtmosphere`
 * subscribes to the same engine) and persists it for next time, same
 * "no separate apply step" shape as `AudioSettingsPanel`.
 */
export function GraphicsSettingsPanel({ onClose }: GraphicsSettingsPanelProps) {
  const { t } = useTranslation();
  const { settings, reducedMotionActive, setEffectsEnabled, setColorBlindMode, setReducedMotion } =
    useGraphicsSettings();

  return (
    <div className="audio-settings-overlay" role="dialog" aria-label={t("graphicsSettings.heading")}>
      <div className="audio-settings-panel">
        <h2>{t("graphicsSettings.heading")}</h2>

        <div className="audio-settings-row">
          <label className="audio-settings-label" htmlFor="graphics-effects-toggle">
            {t("graphicsSettings.effects")}
          </label>
          <span />
          <button
            type="button"
            id="graphics-effects-toggle"
            className={settings.effectsEnabled ? "audio-mute-button" : "audio-mute-button audio-mute-active"}
            onClick={() => setEffectsEnabled(!settings.effectsEnabled)}
            aria-pressed={!settings.effectsEnabled}
          >
            {settings.effectsEnabled ? t("graphicsSettings.on") : t("graphicsSettings.off")}
          </button>
        </div>
        <p className="hint">{t("graphicsSettings.hint")}</p>

        <div className="audio-settings-row">
          <label className="audio-settings-label" htmlFor="graphics-colorblind-toggle">
            {t("graphicsSettings.colorBlindMode")}
          </label>
          <span />
          <button
            type="button"
            id="graphics-colorblind-toggle"
            className={settings.colorBlindMode ? "audio-mute-button audio-mute-active" : "audio-mute-button"}
            onClick={() => setColorBlindMode(!settings.colorBlindMode)}
            aria-pressed={settings.colorBlindMode}
          >
            {settings.colorBlindMode ? t("graphicsSettings.on") : t("graphicsSettings.off")}
          </button>
        </div>
        <p className="hint">{t("graphicsSettings.colorBlindHint")}</p>

        <div className="audio-settings-row">
          <label className="audio-settings-label" htmlFor="graphics-reduced-motion">
            {t("graphicsSettings.reducedMotion")}
          </label>
          <span />
          <select
            id="graphics-reduced-motion"
            className="audio-settings-select"
            value={settings.reducedMotion}
            onChange={(event) => setReducedMotion(event.target.value as MotionPreference)}
          >
            <option value="system">
              {t("graphicsSettings.motionSystem", {
                resolved: reducedMotionActive
                  ? t("graphicsSettings.on")
                  : t("graphicsSettings.off"),
              })}
            </option>
            <option value="on">{t("graphicsSettings.on")}</option>
            <option value="off">{t("graphicsSettings.off")}</option>
          </select>
        </div>
        <p className="hint">{t("graphicsSettings.reducedMotionHint")}</p>

        <button type="button" className="secondary" onClick={onClose}>
          {t("graphicsSettings.closeButton")}
        </button>
      </div>
    </div>
  );
}
