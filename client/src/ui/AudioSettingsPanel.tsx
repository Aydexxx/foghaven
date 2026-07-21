import { useTranslation } from "react-i18next";
import type { AudioBus } from "../audio/audioEngine";
import { useAudioSettings } from "../audio/useAudioSettings";

interface AudioSettingsPanelProps {
  onClose: () => void;
}

const BUSES: AudioBus[] = ["master", "music", "sfx"];

function mutedKey(bus: AudioBus): "mutedMaster" | "mutedMusic" | "mutedSfx" {
  return bus === "master" ? "mutedMaster" : bus === "music" ? "mutedMusic" : "mutedSfx";
}

/**
 * Master / music / sfx volume and mute, all of it live — every slider and
 * toggle here writes straight through `audioEngine`, which applies it to
 * the actual gain nodes immediately and persists it for next time. There is
 * no separate "apply" step: what the sliders show is what's playing.
 */
export function AudioSettingsPanel({ onClose }: AudioSettingsPanelProps) {
  const { t } = useTranslation();
  const { settings, setVolume, setMuted } = useAudioSettings();

  return (
    <div className="audio-settings-overlay" role="dialog" aria-label={t("audioSettings.heading")}>
      <div className="audio-settings-panel">
        <h2>{t("audioSettings.heading")}</h2>

        {BUSES.map((bus) => {
          const muted = settings[mutedKey(bus)];
          return (
            <div className="audio-settings-row" key={bus}>
              <label className="audio-settings-label" htmlFor={`audio-volume-${bus}`}>
                {t(`audioSettings.${bus}`)}
              </label>
              <input
                id={`audio-volume-${bus}`}
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings[bus]}
                disabled={muted}
                onChange={(e) => setVolume(bus, Number(e.target.value))}
              />
              <button
                type="button"
                className={muted ? "audio-mute-button audio-mute-active" : "audio-mute-button"}
                onClick={() => setMuted(bus, !muted)}
                aria-pressed={muted}
              >
                {muted ? t("audioSettings.unmute") : t("audioSettings.mute")}
              </button>
            </div>
          );
        })}

        <button type="button" className="secondary" onClick={onClose}>
          {t("audioSettings.closeButton")}
        </button>
      </div>
    </div>
  );
}
