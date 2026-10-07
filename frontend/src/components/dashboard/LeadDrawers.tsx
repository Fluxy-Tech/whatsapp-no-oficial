import { useEffect, useState, type FormEvent } from "react";
import { CalendarDays, MessageSquare, Trash2 } from "lucide-react";
import {
  DEFAULT_SOURCE,
  formatPhone,
  leadName,
  meetingStatus,
  meetingWhen,
  type LeadCard,
  type MeetingStatus,
  type PipelineStage,
} from "@/lib/dashboard";
import { ComboboxInput } from "@/components/ui/combobox-input";
import { LeadNotes } from "@/components/dashboard/LeadNotes";
import type { Member } from "@/lib/organization";
import { type Target, targetLabel } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Label } from "@/components/ui/label";
import { OptionsSelect } from "@/components/ui/options-select";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

type Meeting = NonNullable<LeadCard["meeting"]>;

const MEETING_LABEL: Record<MeetingStatus, (meeting: Meeting) => string> = {
  upcoming: (meeting) => `Vai acontecer em ${meetingWhen(meeting.startsAt)}`,
  ongoing: () => "Acontecendo agora",
  past: (meeting) => `Ocorreu em ${meetingWhen(meeting.startsAt)}`,
};

const stageOptionsOf = (stages: PipelineStage[]) => stages.map((stage) => ({ value: stage.id, label: stage.name }));
const memberOptionsOf = (members: Member[]) =>
  members.map((member) => ({ value: member.userId, label: member.name }));

// "" in the form = let the lead distribution pick the responsible member.
const AUTO_ASSIGNEE = "";

export type NewLead = { targetId: string; stageId: string; source: string; assigneeId?: string };

type AddLeadDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineName: string;
  stages: PipelineStage[];
  /** Column the drawer was opened from (preselected). */
  initialStageId?: string | null;
  targets: Target[];
  members: Member[];
  /** Origins already used (suggestions); any other can be typed. */
  sources: string[];
  onSubmit: (lead: NewLead) => Promise<boolean>;
};

export function AddLeadDrawer({
  open,
  onOpenChange,
  pipelineName,
  stages,
  initialStageId,
  targets,
  members,
  sources,
  onSubmit,
}: AddLeadDrawerProps) {
  const [draft, setDraft] = useState({
    targetId: "",
    stageId: "",
    source: DEFAULT_SOURCE,
    assigneeId: AUTO_ASSIGNEE,
  });
  const [saving, setSaving] = useState(false);

  // A fresh form every time the drawer opens.
  useEffect(() => {
    if (open) {
      setDraft({
        targetId: "",
        stageId: initialStageId ?? stages[0]?.id ?? "",
        source: DEFAULT_SOURCE,
        assigneeId: AUTO_ASSIGNEE,
      });
    }
  }, [open, stages, initialStageId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!draft.targetId || !draft.stageId || !draft.source.trim()) return;
    setSaving(true);
    const ok = await onSubmit({
      targetId: draft.targetId,
      stageId: draft.stageId,
      source: draft.source.trim(),
      ...(draft.assigneeId ? { assigneeId: draft.assigneeId } : {}),
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <DrawerHeader>
            <DrawerTitle>Novo lead</DrawerTitle>
            <DrawerDescription>Adicionar à esteira "{pipelineName}".</DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="space-y-2">
              <Label htmlFor="new-lead-target">Lead</Label>
              <OptionsSelect
                id="new-lead-target"
                value={draft.targetId}
                onValueChange={(targetId) => setDraft({ ...draft, targetId })}
                placeholder="Selecione um contato"
                options={targets.map((target) => ({
                  value: target.id,
                  label: `${targetLabel(target)}${target.number ? ` (+${target.number})` : ""}`,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                Se o lead já estiver em outra esteira, ele é movido para esta.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-lead-source">Origem</Label>
              <ComboboxInput
                id="new-lead-source"
                value={draft.source}
                onChange={(source) => setDraft({ ...draft, source })}
                options={sources}
                placeholder="Ex.: WhatsApp, Instagram, Site"
                required
              />
              <p className="text-xs text-muted-foreground">
                Escolha uma origem da lista ou digite uma nova.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-lead-stage">Coluna</Label>
              <OptionsSelect
                id="new-lead-stage"
                value={draft.stageId}
                onValueChange={(stageId) => setDraft({ ...draft, stageId })}
                placeholder="Escolha a coluna"
                options={stageOptionsOf(stages)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-lead-assignee">Responsável</Label>
              <OptionsSelect
                id="new-lead-assignee"
                value={draft.assigneeId}
                onValueChange={(assigneeId) => setDraft({ ...draft, assigneeId })}
                options={[{ value: AUTO_ASSIGNEE, label: "Distribuir automaticamente" }, ...memberOptionsOf(members)]}
              />
              <p className="text-xs text-muted-foreground">
                Automático: vai para quem recebe leads e tem menos leads atribuídos.
              </p>
            </div>
          </div>

          <DrawerFooter>
            <Button type="submit" disabled={saving || !draft.targetId || !draft.stageId || !draft.source.trim()}>
              {saving ? "Adicionando..." : "Adicionar lead"}
            </Button>
            <DrawerClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancelar
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

/** Editable origin of the card: pick a suggestion or type a new one, then save. */
function SourceField({
  card,
  sources,
  canEdit,
  onSave,
}: {
  card: LeadCard;
  sources: string[];
  canEdit: boolean;
  onSave: (card: LeadCard, source: string) => Promise<void>;
}) {
  const [value, setValue] = useState(card.source);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another card opened, or the origin changed elsewhere.
  useEffect(() => {
    setValue(card.source);
    setError(null);
  }, [card.id, card.source]);

  const changed = value.trim() !== card.source;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || !changed) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(card, value.trim());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <Label htmlFor="lead-source">Origem</Label>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <ComboboxInput
            id="lead-source"
            value={value}
            onChange={(next) => {
              setValue(next);
              setError(null);
            }}
            options={sources}
            placeholder="Ex.: WhatsApp, Instagram, Site"
            disabled={!canEdit || saving}
          />
        </div>
        {canEdit && changed && (
          <Button type="submit" disabled={saving || !value.trim()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

type LeadCardDrawerProps = {
  card: LeadCard | null;
  onOpenChange: (open: boolean) => void;
  stages: PipelineStage[];
  members: Member[];
  canEdit: boolean;
  onMove: (card: LeadCard, stageId: string) => void;
  onAssign: (card: LeadCard, assigneeId: string) => void;
  onRemove: (card: LeadCard) => void;
  onOpenChat: (card: LeadCard) => void;
  /** Origin suggestions for the editable "Origem" field. */
  sources: string[];
  onSourceChange: (card: LeadCard, source: string) => Promise<void>;
};

/** Lead opened from the board: data collected by the agent, column and responsible. */
export function LeadCardDrawer({
  card,
  onOpenChange,
  stages,
  members,
  canEdit,
  onMove,
  onAssign,
  onRemove,
  onOpenChat,
  sources,
  onSourceChange,
}: LeadCardDrawerProps) {
  const extras = card ? Object.entries(card.lead.extras).filter(([, value]) => String(value).trim()) : [];

  return (
    <Drawer open={Boolean(card)} onOpenChange={onOpenChange}>
      <DrawerContent>
        {card && (
          <>
            <DrawerHeader>
              <DrawerTitle>{leadName(card.lead)}</DrawerTitle>
              <DrawerDescription>{formatPhone(card.lead.number) || card.lead.chatId}</DrawerDescription>
            </DrawerHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              <SourceField card={card} sources={sources} canEdit={canEdit} onSave={onSourceChange} />

              <div className="space-y-2">
                <Label htmlFor="lead-stage">Coluna</Label>
                <OptionsSelect
                  id="lead-stage"
                  value={card.stageId}
                  onValueChange={(stageId) => onMove(card, stageId)}
                  disabled={!canEdit}
                  options={stageOptionsOf(stages)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lead-assignee">Responsável</Label>
                <OptionsSelect
                  id="lead-assignee"
                  value={card.assignee?.id ?? ""}
                  onValueChange={(assigneeId) => onAssign(card, assigneeId)}
                  disabled={!canEdit}
                  options={[{ value: "", label: "Sem responsável" }, ...memberOptionsOf(members)]}
                />
              </div>

              {card.meeting && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Agenda</p>
                  <div className="rounded-md border px-3 py-2">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 break-words">{card.meeting.title}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{MEETING_LABEL[meetingStatus(card.meeting)](card.meeting)}</p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-medium">Dados coletados</p>
                {extras.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum dado coletado ainda.</p>
                ) : (
                  <dl className="divide-y rounded-md border">
                    {extras.map(([key, value]) => (
                      <div key={key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2 text-sm">
                        <dt className="truncate text-muted-foreground">{key}</dt>
                        <dd className="break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>

              <LeadNotes leadId={card.lead.id} canEdit={canEdit} />

              <dl className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <dt>Entrou no quadro</dt>
                  <dd>{DATE_TIME.format(new Date(card.createdAt))}</dd>
                </div>
                {card.lead.lastMessageAt && (
                  <div className="flex justify-between gap-2">
                    <dt>Última mensagem</dt>
                    <dd>{DATE_TIME.format(new Date(card.lead.lastMessageAt))}</dd>
                  </div>
                )}
              </dl>
            </div>

            <DrawerFooter>
              <Button type="button" onClick={() => onOpenChat(card)}>
                <MessageSquare className="h-4 w-4" />
                Abrir conversa
              </Button>
              {canEdit && (
                <Button type="button" variant="ghost" className="text-destructive" onClick={() => onRemove(card)}>
                  <Trash2 className="h-4 w-4" />
                  Apagar
                </Button>
              )}
              <DrawerClose asChild>
                <Button type="button" variant="outline">
                  Fechar
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
