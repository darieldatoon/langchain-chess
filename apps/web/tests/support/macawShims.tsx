// Radix Select and Slider need real pointer geometry; native controls stand in for them so
// tests drive the panel with fireEvent. The shims honour the props our code relies on.
interface Option {
  value: string;
  label?: string;
  disabled?: boolean;
}

export function selectShim() {
  return {
    Select: ({
      options,
      value,
      onChange,
      disabled,
      "aria-label": label,
    }: {
      options: readonly Option[];
      value?: string;
      onChange: (v: string | undefined) => void;
      disabled?: boolean;
      "aria-label"?: string;
    }) => (
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      >
        <option value="">(none)</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label ?? o.value}
          </option>
        ))}
      </select>
    ),
  };
}

export function sliderShim() {
  return {
    Slider: ({
      value,
      onChange,
      min,
      max,
      step,
      "aria-label": label,
    }: {
      value?: number | number[];
      onChange?: (v: number | number[]) => void;
      min?: number;
      max?: number;
      step?: number;
      "aria-label"?: string;
    }) => (
      <input
        type="range"
        aria-label={label}
        value={Array.isArray(value) ? value[0] : value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange?.(Number(e.target.value))}
      />
    ),
  };
}
