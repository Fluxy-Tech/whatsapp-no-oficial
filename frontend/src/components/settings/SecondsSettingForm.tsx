import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SecondsSettingFormProps = {
  id: string;
  /** Field of PATCH /api/organizations/current/settings. */
  field: "messageWaitSeconds" | "agentMessageDelaySeconds";
  label: string;
  help: ReactNode;
  min: number;
  max: number;
  initialValue: number;
  disabled?: boolean;
  onSaved: () => Promise<void> | void;
};

/** A company setting measured in whole seconds (e.g. the agent's wait times). */
export function SecondsSettingForm({ id, field, label, help, min, max, initialValue, disabled, onSaved }: SecondsSettingFormProps) {
  const [value, setValue] = useState(String(initialValue));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // The organization loads asynchronously.
  useEffect(() => setValue(String(initialValue)), [initialValue]);

  const seconds = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(seconds) && seconds >= min && seconds <= max;
  const unchanged = seconds === initialValue;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || unchanged) return;

    setSaving(true);
    setFeedback(null);
    try {
      await api("/api/organizations/current/settings", {
        method: "PATCH",
        body: JSON.stringify({ [field]: seconds }),
      });
      await onSaved();
      setFeedback({ type: "success", text: "Alterações salvas." });
    } catch (err) {
      setFeedback({ type: "error", text: (err as Error).message || "Não foi possível salvar." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          className="max-w-32"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setFeedback(null);
          }}
          disabled={disabled || saving}
        />
        {!disabled && (
          <Button type="submit" disabled={saving || !valid || unchanged}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {help} De {min} a {max} segundos.
      </p>
      {feedback && (
        <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {feedback.text}
        </p>
      )}
    </form>
  );
}
