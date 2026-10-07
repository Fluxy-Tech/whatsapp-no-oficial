import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type SelectOption = { value: string; label: string };

type OptionsSelectProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "default";
  className?: string;
  "aria-label"?: string;
};

// Radix Select reserves "" for "no value", but our forms use "" for options
// like "Sem responsável" / "Não mover". It is swapped for this sentinel.
const EMPTY = "__empty__";
const toRadix = (value: string) => (value === "" ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? "" : value);

/** shadcn Select from a list of { value, label } (value "" allowed). */
export function OptionsSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  size,
  className,
  "aria-label": ariaLabel,
}: OptionsSelectProps) {
  const hasValue = options.some((option) => option.value === value);
  return (
    <Select
      value={hasValue ? toRadix(value) : ""}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      disabled={disabled}
    >
      <SelectTrigger id={id} size={size} className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value || EMPTY} value={toRadix(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
