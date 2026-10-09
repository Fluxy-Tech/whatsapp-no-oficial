import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MESSAGE_MAX = 1000;

type AgentFailureFormProps = {
  initialMessage: string;
  initialAlertPhone: string;
  disabled?: boolean;
  onSaved: () => Promise<void> | void;
};

/**
 * What happens when the agent fails to answer (e.g. the AI model is
 * overloaded): the contact gets a default message and the alert number is
 * warned with the contact's name and number.
 */
export function AgentFailureForm({ initialMessage, initialAlertPhone, disabled, onSaved }: AgentFailureFormProps) {
  const [message, setMessage] = useState(initialMessage);
  const [alertPhone, setAlertPhone] = useState(initialAlertPhone);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // The organization loads asynchronously.
  useEffect(() => setMessage(initialMessage), [initialMessage]);
  useEffect(() => setAlertPhone(initialAlertPhone), [initialAlertPhone]);

  const digits = alertPhone.replace(/\D/g, "");
  const validPhone = !digits || (digits.length >= 10 && digits.length <= 15);
  const valid = validPhone && message.trim().length <= MESSAGE_MAX;
  const unchanged = message.trim() === initialMessage.trim() && digits === initialAlertPhone;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || unchanged) return;

    setSaving(true);
    setFeedback(null);
    try {
      await api("/api/organizations/current/settings", {
        method: "PATCH",
        body: JSON.stringify({ agentFailureMessage: message, alertPhoneNumber: alertPhone }),
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="organization-agent-failure-message">Mensagem quando o agente falhar</Label>
        <Textarea
          id="organization-agent-failure-message"
          rows={3}
          maxLength={MESSAGE_MAX}
          placeholder="Ex.: Estamos com uma instabilidade no momento. Já avisamos nossa equipe e logo retornamos seu contato."
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            setFeedback(null);
          }}
          disabled={disabled || saving}
        />
        <p className="text-xs text-muted-foreground">
          Enviada ao contato quando o agente não consegue responder (por exemplo, quando o modelo de IA está
          sobrecarregado). Em branco, o contato não recebe nada.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="organization-alert-phone">Número de alerta</Label>
        <Input
          id="organization-alert-phone"
          inputMode="tel"
          className="max-w-64"
          placeholder="5511999999999"
          value={alertPhone}
          onChange={(event) => {
            setAlertPhone(event.target.value);
            setFeedback(null);
          }}
          disabled={disabled || saving}
        />
        <p className="text-xs text-muted-foreground">
          Recebe um aviso no WhatsApp com o nome e o número do contato sempre que o agente falhar. Use DDI + DDD +
          número. Em branco, ninguém é avisado.
        </p>
        {!validPhone && <p className="text-sm text-destructive">Número inválido: use de 10 a 15 dígitos.</p>}
      </div>

      {!disabled && (
        <Button type="submit" disabled={saving || !valid || unchanged}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      )}
      {feedback && (
        <p className={feedback.type === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {feedback.text}
        </p>
      )}
    </form>
  );
}
