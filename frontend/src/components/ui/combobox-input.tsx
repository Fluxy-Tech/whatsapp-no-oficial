import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type ComboboxInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Suggestions shown in the list; any other typed text is accepted too. */
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
};

/** Text field with a suggestion list: pick an option or type a new value. */
export function ComboboxInput({ id, value, onChange, options, placeholder, disabled, required }: ComboboxInputProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const term = value.trim().toLowerCase();
  const exact = options.some((option) => option.toLowerCase() === term);
  // While the value is one of the options, show them all (it works like a select).
  const filtered = useMemo(
    () => (exact || !term ? options : options.filter((option) => option.toLowerCase().includes(term))),
    [options, term, exact],
  );
  const items = term && !exact ? [...filtered, value.trim()] : filtered;

  function choose(option: string) {
    onChange(option);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && items[highlighted]) {
      event.preventDefault();
      choose(items[highlighted]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlighted(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on an option lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
      />
      {open && items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-background p-1 shadow-md"
        >
          {items.map((option, index) => {
            const isNew = term !== "" && !exact && index === items.length - 1;
            const selected = option.toLowerCase() === term;
            return (
              <li
                key={`${option}-${index}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onMouseEnter={() => setHighlighted(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                  highlighted === index && "bg-accent text-accent-foreground",
                )}
              >
                {isNew ? (
                  <>
                    <Plus className="h-4 w-4 text-muted-foreground" />
                    Usar "{option}"
                  </>
                ) : (
                  <>
                    <span className="flex-1">{option}</span>
                    {selected && <Check className="h-4 w-4" />}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
