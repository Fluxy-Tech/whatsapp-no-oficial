import { useEffect, useState } from "react";
import { BookOpen, Coins, Save, Trash2, UserRound, Workflow } from "lucide-react";
import { TokenUsagePanel } from "@/components/agents/TokenUsagePanel";
import { api } from "@/lib/api";
import type { Agent, SecretInfo } from "@/lib/agents";
import { stageOptions as toStageOptions, type Pipeline } from "@/lib/dashboard";
import type { Member } from "@/lib/organization";
import { TabsNav, type TabItem } from "@/components/ui/tabs-nav";
import {
  KanbanAutomationCard,
  SchedulingCard,
  type KanbanDraft,
  type SchedulingDraft,
} from "@/components/agents/AgentAutomationCards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AgentDocuments } from "@/components/agents/AgentDocuments";
import { KeywordsInput } from "@/components/agents/KeywordsInput";
import { MetadadosEditor, type MetadadoDraft, type StageOption } from "@/components/agents/MetadadosEditor";

type TokenDraft = { value: string; remove: boolean };

type Form = {
  name: string;
  active: boolean;
  context: string;
  tokenOpenAi: TokenDraft;
  tokenAdk: TokenDraft;
  metadados: MetadadoDraft[];
  resetKeywords: string[];
  resetMessage: string;
  numberPhoneNotification: string;
  descriptionNotification: string;
  kanban: KanbanDraft;
  scheduling: SchedulingDraft;
};

const DEFAULT_RESET_MESSAGE =
  "Prontinho! Encerrei nossa conversa e apaguei os dados que eu tinha guardado sobre você. Quando quiser, é só mandar uma mensagem para começarmos de novo.";

const DEFAULT_NOTIFICATION_DESCRIPTION =
  "Envie um relatório curto da conversa com o contato e liste todos os metadados coletados.";

function toForm(agent: Agent | null): Form {
  return {
    name: agent?.name ?? "",
    active: agent?.active ?? true,
    context: agent?.context ?? "",
    tokenOpenAi: { value: "", remove: false },
    tokenAdk: { value: "", remove: false },
    metadados: (agent?.metadados ?? []).map((m) => ({
      key: m.id,
      id: m.id,
      name: m.name,
      descricao: m.descricao,
      stageId: m.stageId,
    })),
    resetKeywords: agent?.resetKeywords ?? [],
    resetMessage: agent?.resetMessage ?? DEFAULT_RESET_MESSAGE,
    numberPhoneNotification: agent?.numberPhoneNotification ?? "",
    descriptionNotification: agent?.descriptionNotification ?? DEFAULT_NOTIFICATION_DESCRIPTION,
    kanban: {
      leadOnFirstMessage: agent?.leadOnFirstMessage ?? false,
      leadStageId: agent?.leadStageId ?? "",
      completedStageId: agent?.completedStageId ?? "",
      leadAssigneeId: agent?.leadAssigneeId ?? "",
    },
    scheduling: {
      enabled: agent?.scheduling.enabled ?? false,
      meetingDurationMinutes: String(agent?.scheduling.meetingDurationMinutes ?? 60),
      startTime: agent?.scheduling.startTime ?? "09:00",
      endTime: agent?.scheduling.endTime ?? "18:00",
      weekdays: agent?.scheduling.weekdays ?? [1, 2, 3, 4, 5],
      maxEventsPerDay: agent?.scheduling.maxEventsPerDay?.toString() ?? "",
      maxEventsPerSlot: agent?.scheduling.maxEventsPerSlot?.toString() ?? "",
    },
  };
}

const optionalNumber = (value: string) => (value.trim() ? Number(value) : null);

// undefined = keep the stored key, null = remove it, string = replace it.
function tokenPayload(draft: TokenDraft) {
  if (draft.remove) return null;
  return draft.value.trim() ? draft.value.trim() : undefined;
}

type TokenFieldProps = {
  id: string;
  label: string;
  help: string;
  stored: SecretInfo | null;
  draft: TokenDraft;
  onChange: (draft: TokenDraft) => void;
  disabled: boolean;
};

function TokenField({ id, label, help, stored, draft, onChange, disabled }: TokenFieldProps) {
  const configured = stored?.configured && !draft.remove;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="password"
          autoComplete="off"
          value={draft.value}
          onChange={(e) => onChange({ value: e.target.value, remove: false })}
          placeholder={configured ? `Configurado (•••• ${stored?.last4}) — deixe vazio para manter` : "Cole a chave aqui"}
          disabled={disabled}
        />
        {stored?.configured && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => onChange({ value: "", remove: !draft.remove })}
          >
            {draft.remove ? "Desfazer" : "Remover"}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {draft.remove ? "A chave será removida ao salvar." : help}
      </p>
    </div>
  );
}

type Tab = "perfil" | "funcoes" | "documentacao" | "consumo";

const TABS: TabItem<Tab>[] = [
  { id: "perfil", label: "Perfil do agente", icon: UserRound },
  { id: "funcoes", label: "Funções", icon: Workflow },
  { id: "documentacao", label: "Documentação", icon: BookOpen },
  { id: "consumo", label: "Consumo", icon: Coins },
];

type AgentEditorProps = {
  agent: Agent | null;
  canEdit: boolean;
  onSaved: (agent: Agent) => void;
  onDeleted: (agentId: string) => void;
  onToggleOrganizationAgent: (agent: Agent) => void;
};

export function AgentEditor({ agent, canEdit, onSaved, onDeleted, onToggleOrganizationAgent }: AgentEditorProps) {
  const [form, setForm] = useState<Form>(() => toForm(agent));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("perfil");
  const [stageOptions, setStageOptions] = useState<StageOption[]>([]);
  const [stagesError, setStagesError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);

  // Kanban columns for the automation selects.
  useEffect(() => {
    api<Pipeline[]>("/api/dashboard/kanban/pipelines")
      .then((pipelines) => setStageOptions(toStageOptions(pipelines)))
      .catch((err) => setStagesError(`Não foi possível carregar as esteiras: ${(err as Error).message}`));
    api<Member[]>("/api/organizations/current/members").then(setMembers).catch(() => {});
  }, []);

  // Reset the form when switching agents (not on every document status update).
  useEffect(() => {
    setForm(toForm(agent));
    setError(null);
    setSavedAt(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id]);

  const disabled = !canEdit || saving;

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: form.name,
        active: form.active,
        context: form.context,
        tokenOpenAi: tokenPayload(form.tokenOpenAi),
        tokenAdk: tokenPayload(form.tokenAdk),
        metadados: form.metadados.map(({ id, name, descricao, stageId }) => ({ id, name, descricao, stageId })),
        resetKeywords: form.resetKeywords,
        resetMessage: form.resetMessage,
        numberPhoneNotification: form.numberPhoneNotification.trim() || null,
        descriptionNotification: form.descriptionNotification,
        leadOnFirstMessage: form.kanban.leadOnFirstMessage,
        leadStageId: form.kanban.leadStageId || null,
        completedStageId: form.kanban.completedStageId || null,
        leadAssigneeId: form.kanban.leadAssigneeId || null,
        scheduling: {
          enabled: form.scheduling.enabled,
          meetingDurationMinutes: Number(form.scheduling.meetingDurationMinutes),
          startTime: form.scheduling.startTime,
          endTime: form.scheduling.endTime,
          weekdays: form.scheduling.weekdays,
          maxEventsPerDay: optionalNumber(form.scheduling.maxEventsPerDay),
          maxEventsPerSlot: optionalNumber(form.scheduling.maxEventsPerSlot),
        },
      };
      const saved = agent
        ? await api<Agent>(`/api/agents/${agent.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<Agent>("/api/agents", { method: "POST", body: JSON.stringify(body) });
      setForm(toForm(saved));
      setSavedAt(Date.now());
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!agent || !confirm(`Excluir o agente "${agent.name}"? Os documentos dele também serão apagados.`)) return;
    setSaving(true);
    try {
      await api(`/api/agents/${agent.id}`, { method: "DELETE" });
      onDeleted(agent.id);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <TabsNav tabs={TABS} value={tab} onChange={setTab} />

      {tab === "consumo" &&
        (agent ? (
          <TokenUsagePanel agentId={agent.id} />
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Crie o agente para acompanhar o consumo de tokens.
            </CardContent>
          </Card>
        ))}

      {(tab === "perfil" || tab === "funcoes") && (
        <form onSubmit={handleSave} className="space-y-6">
          {tab === "perfil" && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{agent ? agent.name : "Novo agente"}</CardTitle>
                    <CardDescription>
                      {agent?.isOrganizationAgent
                        ? agent.canAnswer
                          ? "Este agente está respondendo os contatos da organização."
                          : "Selecionado para a organização, mas só responde quando estiver ativo e com prompt."
                        : "Defina como o agente deve atender e quais dados ele precisa coletar."}
                    </CardDescription>
                  </div>
                  {agent && canEdit && (
                    <Button type="button" variant="outline" size="sm" onClick={() => onToggleOrganizationAgent(agent)}>
                      {agent.isOrganizationAgent ? "Parar de usar na organização" : "Usar nas conversas da organização"}
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                  <div className="space-y-2">
                    <Label htmlFor="agent-name">Nome</Label>
                    <Input
                      id="agent-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="Ex.: Ana, atendente da padaria"
                      required
                      disabled={disabled}
                    />
                  </div>
                  <label className="flex h-10 items-center gap-2 text-sm font-medium">
                    <Switch
                      checked={form.active}
                      onCheckedChange={(active) => setForm({ ...form, active })}
                      disabled={disabled}
                      aria-label="Agente ativo"
                    />
                    {form.active ? "Ativo" : "Inativo"}
                  </label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-context">Prompt (contexto)</Label>
                  <Textarea
                    id="agent-context"
                    value={form.context}
                    onChange={(e) => setForm({ ...form, context: e.target.value })}
                    placeholder="Quem é a empresa, o que vende, horários, preços, tom de voz, o que o agente pode e não pode falar..."
                    className="min-h-48"
                    disabled={disabled}
                  />
                  <p className="text-xs text-muted-foreground">Sem prompt o agente não responde.</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <TokenField
                    id="token-adk"
                    label="Token Google (ADK / Gemini)"
                    help="Chave de API do Google AI Studio (aistudio.google.com/apikey). Usada para gerar as respostas; é validada com o Google ao salvar."
                    stored={agent?.tokenAdk ?? null}
                    draft={form.tokenAdk}
                    onChange={(tokenAdk) => setForm({ ...form, tokenAdk })}
                    disabled={disabled}
                  />
                  <TokenField
                    id="token-openai"
                    label="Token OpenAI"
                    help='Chave da OpenAI (começa com "sk-"). Usada para ler os documentos (RAG).'
                    stored={agent?.tokenOpenAi ?? null}
                    draft={form.tokenOpenAi}
                    onChange={(tokenOpenAi) => setForm({ ...form, tokenOpenAi })}
                    disabled={disabled}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {tab === "funcoes" && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Metadados a coletar</CardTitle>
                  <CardDescription>
                    O agente pergunta esses dados durante a conversa e salva nos extras de cada contato.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <MetadadosEditor
                    value={form.metadados}
                    onChange={(metadados) => setForm({ ...form, metadados })}
                    disabled={disabled}
                    stageOptions={stageOptions}
                  />

                  <div className="space-y-2">
                    <Label>Palavras de reset</Label>
                    <p className="text-xs text-muted-foreground">
                      Se o contato mandar exatamente uma destas palavras (maiúsculas, acentos e pontuação não importam), o
                      agente apaga o histórico da conversa e os metadados coletados dele, e recomeça do zero.
                    </p>
                    <KeywordsInput
                      value={form.resetKeywords}
                      onChange={(resetKeywords) => setForm({ ...form, resetKeywords })}
                      placeholder="Ex.: reiniciar"
                      disabled={disabled}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="agent-reset-message">Frase de reset</Label>
                    <Textarea
                      id="agent-reset-message"
                      value={form.resetMessage}
                      onChange={(e) => setForm({ ...form, resetMessage: e.target.value })}
                      className="min-h-16"
                      disabled={disabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      Enviada ao contato quando ele manda uma palavra de reset; a conversa é encerrada e a próxima mensagem
                      começa do zero. Deixe vazio para usar a frase padrão.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Notificação de coleta concluída</CardTitle>
                  <CardDescription>
                    Quando o agente terminar de coletar todos os metadados de um contato, ele gera uma mensagem seguindo
                    a descrição abaixo e envia para este número. Deixe o número vazio para não notificar.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="agent-notification-number">Número de notificação</Label>
                    <Input
                      id="agent-notification-number"
                      type="tel"
                      inputMode="tel"
                      value={form.numberPhoneNotification}
                      onChange={(e) => setForm({ ...form, numberPhoneNotification: e.target.value })}
                      placeholder="Ex.: 5511999999999"
                      disabled={disabled}
                    />
                    <p className="text-xs text-muted-foreground">Com DDI e DDD. Precisa ter WhatsApp.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="agent-notification-description">Descrição da notificação</Label>
                    <Textarea
                      id="agent-notification-description"
                      value={form.descriptionNotification}
                      onChange={(e) => setForm({ ...form, descriptionNotification: e.target.value })}
                      placeholder="Ex.: Um relatório da conversa, o interesse do cliente e os metadados coletados."
                      className="min-h-20"
                      disabled={disabled}
                    />
                    <p className="text-xs text-muted-foreground">
                      O que a mensagem deve conter. O agente usa a conversa e os metadados coletados para escrevê-la.
                      Deixe vazio para usar a descrição padrão.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <KanbanAutomationCard
                value={form.kanban}
                onChange={(kanban) => setForm({ ...form, kanban })}
                stageOptions={stageOptions}
                stagesError={stagesError}
                members={members}
                disabled={disabled}
              />

              <SchedulingCard
                value={form.scheduling}
                onChange={(scheduling) => setForm({ ...form, scheduling })}
                disabled={disabled}
              />
            </>
          )}

          {(error || canEdit) && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                {error && <p className="text-sm text-destructive">{error}</p>}

                {canEdit && (
                  <div className="flex items-center justify-between gap-2">
                    {agent ? (
                      <Button type="button" variant="ghost" className="text-destructive" onClick={handleDelete} disabled={saving}>
                        <Trash2 className="h-4 w-4" />
                        Excluir agente
                      </Button>
                    ) : (
                      <span />
                    )}
                    <div className="flex items-center gap-3">
                      {savedAt && !saving && <span className="text-xs text-muted-foreground">Salvo</span>}
                      <Button type="submit" disabled={saving}>
                        <Save className="h-4 w-4" />
                        {saving ? "Salvando..." : agent ? "Salvar alterações" : "Criar agente"}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </form>
      )}

      {tab === "documentacao" && (
        <Card>
          <CardHeader>
            <CardTitle>Documentos (RAG)</CardTitle>
            <CardDescription>
              Arquivos e links que o agente consulta para responder. Cada documento é quebrado em trechos e indexado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {agent ? (
              <AgentDocuments agent={agent} canEdit={canEdit} onAgentChange={onSaved} />
            ) : (
              <p className="text-sm text-muted-foreground">Crie o agente para adicionar documentos.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
