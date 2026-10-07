import { useEffect, useState } from "react";
import { MessageSquare, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatRelativeTime } from "@/lib/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { targetLabel, type Target } from "@/lib/leads";

type ExtraRow = { key: string; name: string; value: string };

function toRows(extras: Record<string, string>, metadadoNames: string[]): ExtraRow[] {
  // Metadados of the organization's agent always show up (even if empty),
  // followed by any other key already stored on the contact.
  const names = [...metadadoNames, ...Object.keys(extras).filter((name) => !metadadoNames.includes(name))];
  return names.map((name) => ({ key: name, name, value: extras[name] ?? "" }));
}

type TargetDetailProps = {
  target: Target;
  /** Names of the metadados of the agent in use by the organization. */
  metadadoNames: string[];
  canEdit: boolean;
  onOpenChat: (target: Target) => void;
  onUpdated: (target: Partial<Target> & { targetId: string }) => void;
};

export function TargetDetail({ target, metadadoNames, canEdit, onOpenChat, onUpdated }: TargetDetailProps) {
  const [rows, setRows] = useState<ExtraRow[]>(() => toRows(target.extras, metadadoNames));
  const [savingExtras, setSavingExtras] = useState(false);
  const [togglingAgent, setTogglingAgent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Take server changes (e.g. the agent just collected a value) unless the
  // user is in the middle of editing.
  useEffect(() => {
    if (!dirty) setRows(toRows(target.extras, metadadoNames));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.extras, metadadoNames.join("|")]);

  useEffect(() => {
    setDirty(false);
    setError(null);
    setRows(toRows(target.extras, metadadoNames));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.targetId]);

  function updateRow(key: string, patch: Partial<ExtraRow>) {
    setDirty(true);
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function patchContact(body: { agentActive?: boolean; extras?: Record<string, string> }) {
    const updated = await api<{ agentActive: boolean; extras: Record<string, string> }>(
      `/api/whatsapp/contacts/${encodeURIComponent(target.targetId)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    onUpdated({ targetId: target.targetId, agentActive: updated.agentActive, extras: updated.extras });
  }

  async function handleToggleAgent(agentActive: boolean) {
    setTogglingAgent(true);
    setError(null);
    try {
      await patchContact({ agentActive });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTogglingAgent(false);
    }
  }

  async function handleSaveExtras(event: React.FormEvent) {
    event.preventDefault();
    const names = rows.map((row) => row.name.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) {
      setError("Há metadados com o mesmo nome.");
      return;
    }

    setSavingExtras(true);
    setError(null);
    try {
      // Empty values are not stored.
      const extras = Object.fromEntries(
        rows.filter((row) => row.name.trim() && row.value.trim()).map((row) => [row.name.trim(), row.value.trim()]),
      );
      await patchContact({ extras });
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingExtras(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{targetLabel(target)}</CardTitle>
            <CardDescription className="space-x-2">
              <span>{target.number ? `+${target.number}` : target.targetId}</span>
              {target.isOnline ? (
                <Badge variant="secondary">Online</Badge>
              ) : (
                target.lastSeen && <span>· visto {formatRelativeTime(target.lastSeen)}</span>
              )}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => onOpenChat(target)}>
            <MessageSquare className="h-4 w-4" />
            Abrir conversa
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Agente de IA</p>
            <p className="text-xs text-muted-foreground">
              {target.agentActive
                ? "O agente responde este contato automaticamente."
                : "O agente não responde este contato; só atendimento humano."}
            </p>
          </div>
          <Switch
            checked={target.agentActive}
            onCheckedChange={handleToggleAgent}
            disabled={!canEdit || togglingAgent}
            aria-label="Agente de IA ativo para este contato"
          />
        </div>

        <form onSubmit={handleSaveExtras} className="space-y-3">
          <div>
            <Label>Metadados coletados (extras)</Label>
            <p className="text-xs text-muted-foreground">
              Preenchidos pelo agente durante a conversa. Você pode corrigir ou completar.
            </p>
          </div>

          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum metadado. Configure os metadados no agente em uso para eles aparecerem aqui.
            </p>
          )}

          {rows.map((row) => {
            const fromAgent = metadadoNames.includes(row.name);
            return (
              <div key={row.key} className="flex gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => updateRow(row.key, { name: e.target.value })}
                  placeholder="Nome"
                  className="w-48 shrink-0"
                  disabled={!canEdit || fromAgent}
                  title={fromAgent ? "Metadado definido no agente" : undefined}
                />
                <Input
                  value={row.value}
                  onChange={(e) => updateRow(row.key, { value: e.target.value })}
                  placeholder="Ainda não coletado"
                  disabled={!canEdit}
                />
                {canEdit && !fromAgent && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover"
                    onClick={() => {
                      setDirty(true);
                      setRows((prev) => prev.filter((r) => r.key !== row.key));
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {canEdit && (
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDirty(true);
                  setRows((prev) => [...prev, { key: crypto.randomUUID(), name: "", value: "" }]);
                }}
              >
                <Plus className="h-4 w-4" />
                Outro dado
              </Button>
              <Button type="submit" size="sm" disabled={savingExtras || !dirty}>
                <Save className="h-4 w-4" />
                {savingExtras ? "Salvando..." : "Salvar metadados"}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
