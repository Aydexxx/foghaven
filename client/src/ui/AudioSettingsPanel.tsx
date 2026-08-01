import { useTranslation } from "react-i18next";
import type { AudioBus } from "../audio/audioEngine";
import { useAudioSettings } from "../audio/useAudioSettings";
import { Button, Panel, Slider } from "./primitives";

interface AudioSettingsPanelProps {
  onClose: () => void;
}

const BUSES: AudioBus[] = ["master", "sfx"];

function mutedKey(bus: AudioBus): "mutedMaster" | "mutedSfx" {
  return bus === "master" ? "mutedMaster" : "mutedSfx";
}

/**
 * Master / sfx volume and mute, all of it live — every slider and toggle
 * here writes straight through `audioEngine`, which applies it to the
 * actual gain nodes immediately and persists it for next time. There is no
 * separate "apply" step: what the sliders show is what's playing.
 */
export function AudioSettingsPanel({ onClose }: AudioSettingsPanelProps) {
  const { t } = useTranslation();
  const { settings, setVolume, setMuted } = useAudioSettings();

  return (
    <div className="audio-settings-overlay" role="dialog" aria-label={t("audioSettings.heading")}>
      <Panel className="audio-settings-panel">
        <h2>{t("audioSettings.heading")}</h2>

        {BUSES.map((bus) => {
          const muted = settings[mutedKey(bus)];
          return (
            <div className="audio-settings-row" key={bus}>
              <label className="audio-settings-label" htmlFor={`audio-volume-${bus}`}>
                {t(`audioSettings.${bus}`)}
              </label>
              <Slider
                id={`audio-volume-${bus}`}
                min={0}
                max={1}
                step={0.01}
                value={settings[bus]}
                disabled={muted}
                onChange={(value) => setVolume(bus, value)}
                formatValue={(value) => `${Math.round(value * 100)}%`}
              />
              <Button
                type="button"
                variant="default"
                className={muted ? "audio-mute-button audio-mute-active" : "audio-mute-button"}
                onClick={() => setMuted(bus, !muted)}
                aria-pressed={muted}
              >
                {muted ? t("audioSettings.unmute") : t("audioSettings.mute")}
              </Button>
            </div>
          );
        })}

        <Button type="button" variant="default" className="secondary" onClick={onClose}>
          {t("audioSettings.closeButton")}
        </Button>
      </Panel>
    </div>
  );
}
