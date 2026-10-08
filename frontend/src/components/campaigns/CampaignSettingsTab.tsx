import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Ban, Plus, Save, Trash2, UserX } from "lucide-react";
import { api } from "@/lib/api";
import type { BlockedContact, CampaignSettings } from "@/lib/campaigns";
import { formatPhone } from "@/lib/dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/**
 * Phrases that, when a contact answers a campaign with exactly one of them,
 * block the contact from future campaigns. The list is edited in memory and
 * saved at once.
 */
export function CampaignSettingsTab({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<CampaignSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const [blocked, setBlocked] = useState<BlockedContact[] | null>(null);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const loadBlocked = useCallback(() => {
    api<BlockedContact[]>("/api/campaigns/blocked")
      .then(setBlocked)
      .catch(() => setBlocked([]));
  }, []);

  useEffect(() => {
    api<CampaignSettings>("/api/campaigns/settings")
      .then((value) => {
        setSettings(value);
        setEnabled(value.useWordsToBlockCampaign);
        setWords(value.wordsToBlockCampaign);
      })
      .catch((err) => setMessage({ type: "error", text: (err as Error).message }));
    loadBlocked();
  }, [loadBlocked]);

  function handleAdd(event: FormEvent) {
    event.preventDefault();
    const value = newWord.trim();
    if (!value) return;
    if (!words.some((w) => w.toLowerCase() === value.toLowerCase())) setWords((prev) => [...prev, value]);
    setNewWord("");
  }

  async function handleSave() {
    setMessage(null);
    setSaving(true);
    try {
      const saved = await api<CampaignSettings>("/api/campaigns/settings", {
        method: "PUT",
        body: JSON.stringify({
          useWordsToBlockCampaign: enabled,
          wordsToBlockCampaign: words.map((w) => w.trim()).filter(Boolean),
        }),
      });
      setSettings(saved);
      setWords(saved.wordsToBlockCampaign);
      setMessage({ type: "success", text: "Configurações de bloqueio de campanha atualizadas." });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message || "Não foi possível salvar." });
    } finally {
      setSaving(false);
    }
  }

  async function handleUnblock(targetId: string) {
    setUnblocking(targetId);
    try {
      await api(`/api/campaigns/blocked/${targetId}`, { method: "DELETE" });
      setBlocked((prev) => prev?.filter((b) => b.targetId !== targetId) ?? null);
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    } finally {
      setUnblocking(null);
    }
  }

  const disabled = !canEdit || saving || !settings;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Ban className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Bloqueio automático por frase</CardTitle>
              <CardDescription>
                Quando um contato responde a um disparo de campanha com uma destas frases, ele para de receber campanhas
                — até você desbloqueá-lo abaixo.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!settings ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <Switch
                  checked={enabled}
                  disabled={disabled}
                  onCheckedChange={setEnabled}
                  aria-label="Ativar bloqueio automático"
                />
                <div className="min-w-0 flex-1">
                  <Label>Ativar bloqueio automático</Label>
                  <p className="text-xs text-muted-foreground">
                    Com o switch desligado, as frases abaixo ficam salvas mas não são avaliadas nas respostas dos contatos.
                  </p>
                </div>
              </div>

              <form onSubmit={handleAdd} className="flex items-end gap-2 border-t pt-4">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="block-word-new">Nova frase de bloqueio</Label>
                  <p className="text-xs text-muted-foreground">
                    O contato é bloqueado quando responde exatamente com essa frase (maiúsculas e minúsculas não importam).
                  </p>
                  <Input
                    id="block-word-new"
                    placeholder="ex: não quero mais receber mensagens"
                    disabled={disabled}
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                  />
                </div>
                <Button type="submit" variant="outline" className="gap-2" disabled={disabled || !newWord.trim()}>
                  <Plus className="h-4 w-4" /> Adicionar
                </Button>
              </form>

              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                {words.map((word, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      disabled={disabled}
                      value={word}
                      aria-label={`Frase ${index + 1}`}
                      onChange={(e) => setWords((prev) => prev.map((w, i) => (i === index ? e.target.value : w)))}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      disabled={disabled}
                      aria-label={`Remover frase ${index + 1}`}
                      onClick={() => setWords((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {words.length === 0 && (
                  <p className="py-2 text-center text-sm text-muted-foreground">Nenhuma frase cadastrada ainda.</p>
                )}
              </div>
            </>
          )}

          {message && (
            <p className={message.type === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700"}>
              {message.text}
            </p>
          )}

          {canEdit && settings && (
            <Button type="button" disabled={saving} onClick={() => void handleSave()} className="w-fit gap-2">
              <Save className="h-4 w-4" /> {saving ? "Salvando…" : "Salvar alterações"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <UserX className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Contatos bloqueados</CardTitle>
              <CardDescription>
                Contatos que pediram para não receber campanhas. Ao disparar, eles são retirados da lista (com aviso).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!blocked ? (
            <div className="flex justify-center py-6">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : blocked.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum contato bloqueado.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Contato</th>
                    <th className="px-4 py-2 font-medium">Frase</th>
                    <th className="px-4 py-2 font-medium">Bloqueado em</th>
                    {canEdit && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {blocked.map((b) => (
                    <tr key={b.targetId}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{b.name ?? "Sem nome"}</p>
                        <p className="text-xs text-muted-foreground">{formatPhone(b.phone) || "—"}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{b.reason ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{DATE_TIME.format(new Date(b.createdAt))}</td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={unblocking === b.targetId}
                            onClick={() => void handleUnblock(b.targetId)}
                          >
                            Desbloquear
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
