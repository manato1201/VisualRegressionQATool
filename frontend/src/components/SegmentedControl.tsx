interface Option<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** "tab" when the control switches between views of different content
   * (ARIA tablist); "radio" when it just picks one setting (radiogroup). */
  kind?: "tab" | "radio";
}

/** One segmented control for every "pick one of a few" choice in the viewer
 * (display mode, background, zoom, theme), so they look and behave alike. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  kind = "radio",
}: Props<T>) {
  const isTab = kind === "tab";
  return (
    <div
      className="segment-rail"
      role={isTab ? "tablist" : "radiogroup"}
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <button
            key={option.key}
            type="button"
            role={isTab ? "tab" : "radio"}
            {...(isTab
              ? { "aria-selected": selected }
              : { "aria-checked": selected })}
            onClick={() => onChange(option.key)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
