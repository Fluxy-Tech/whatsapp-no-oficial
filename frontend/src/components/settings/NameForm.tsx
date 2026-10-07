import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type NameFormProps = {
  id: string;
  label: string;
  initialValue: string;
  disabled?: boolean;
  onSave: (name: string) => Promise<{ error?: { message?: string } | null }>;
};

// Single "name" field with its own save state; used for the user and the company.
export function NameForm({ id, label, initialValue, disabled, onSave }: NameFormProps) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // The session/organization loads asynchronously.
  useEffect(() => setValue(initialValue), [initialValue]);

  const name = value.trim();
  const unchanged = name === initialValue.trim();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name || unchanged) return;

    setSaving(true);
    setFeedback(null);
    try {
      const { error } = await onSave(name);
      setFeedback(
        error
          ? { type: "error", text: error.message ?? "Não foi possível salvar." }
          : { type: "success", text: "Alterações salvas." },
      );
    } catch {
      setFeedback({ type: "error", text: "Não foi possível salvar." });
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
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setFeedback(null);
          }}
          disabled={disabled || saving}
        />
        {!disabled && (
          <Button type="submit" disabled={saving || !name || unchanged}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </div>
      {feedback && (
        <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {feedback.text}
        </p>
      )}
    </form>
  );
}
