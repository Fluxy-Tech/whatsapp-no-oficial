import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_SECONDS = 0;
const MAX_SECONDS = 600;

type MessageWaitFormProps = {
  initialValue: number;
  disabled?: boolean;
  onSaved: () => Promise<void> | void;
};

/** How long the agent waits for the contact to stop typing before answering. */
export function MessageWaitForm({ initialValue, disabled, onSaved }: MessageWaitFormProps) {
  const [value, setValue] = useState(String(initialValue));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // The organization loads asynchronously.
  useEffect(() => setValue(String(initialValue)), [initialValue]);

  const seconds = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(seconds) && seconds >= MIN_SECONDS && seconds <= MAX_SECONDS;
  const unchanged = seconds === initialValue;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || unchanged) return;

    setSaving(true);
    setFeedback(null);
    try {
      await api("/api/organizations/current/settings", {
        method: "PATCH",
        body: JSON.stringify({ messageWaitSeconds: seconds }),
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
      <Label htmlFor="organization-message-wait">Tempo de espera por novas mensagens (segundos)</Label>
      <div className="flex gap-2">
        <Input
          id="organization-message-wait"
          type="number"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
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
        O agente espera o contato ficar este tempo sem mandar mensagens antes de responder. Cada nova mensagem reinicia a
        contagem, e todas as mensagens recebidas no período são respondidas juntas, como uma pessoa lendo a conversa. De{" "}
        {MIN_SECONDS} a {MAX_SECONDS} segundos.
      </p>
      {feedback && (
        <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {feedback.text}
        </p>
      )}
    </form>
  );
}
