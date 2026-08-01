import { useId, type CSSProperties } from "react";

interface SliderProps {
  id?: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  /** Formats the JetBrains Mono readout to the right of the track. Defaults to the raw value. */
  formatValue?: (value: number) => string;
  className?: string;
}

/**
 * ART_BIBLE §8 Slider. Wraps a native `<input type="range">` rather than
 * reinventing one — keyboard control (arrow keys, Home/End) and screen
 * reader support come for free, and are exactly the kind of thing a from-
 * scratch drag widget quietly drops. Track (8px, void, fully rounded) and
 * thumb (26px circle, ropeTan, 3px ink border) are restyled via the
 * `::-webkit-slider-*`/`::-moz-range-*` pseudo-elements in `primitives.css`;
 * the fill is a `linear-gradient` driven by the `--ph-slider-fill` custom
 * property computed here, since a single native track can't paint a two-tone
 * fill on its own. The value renders in JetBrains Mono to the right, as a
 * sibling element — never inside the track.
 */
export function Slider({
  id,
  label,
  min = 0,
  max = 1,
  step = 0.01,
  value,
  disabled,
  onChange,
  formatValue,
  className,
}: SliderProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const display = formatValue ? formatValue(value) : String(value);
  const fillStyle = { "--ph-slider-fill": `${pct}%` } as CSSProperties;

  return (
    <div className={["ph-slider", className].filter(Boolean).join(" ")}>
      {label && (
        <label className="ph-slider__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        type="range"
        className="ph-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={fillStyle}
      />
      <span className="ph-slider__value">{display}</span>
    </div>
  );
}
