import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, Bot, CalendarX, RotateCcw, Target as TargetIcon, Trash2 } from "lucide-react";
import type { CalendarEvent } from "@/lib/dashboard";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionsSelect } from "@/components/ui/options-select";
import { Textarea } from "@/components/ui/textarea";

export type NewEvent = {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  assigneeId: string | null;
  targetId: string | null;
  reminderMessage: string | null;
  reminderMinutesBefore: number | null;
};

type ReminderUnit = "minutes" | "hours";
const UNIT_MINUTES: Record<ReminderUnit, number> = { minutes: 1, hours: 60 };

/** 120 -> { amount: "2", unit: "hours" }; 90 -> { amount: "90", unit: "minutes" }. */
function reminderFields(minutesBefore: number | null) {
  if (!minutesBefore) return { reminderAmount: "", reminderUnit: "hours" as ReminderUnit };
  return minutesBefore % 60 === 0
    ? { reminderAmount: String(minutesBefore / 60), reminderUnit: "hours" as ReminderUnit }
    : { reminderAmount: String(minutesBefore), reminderUnit: "minutes" as ReminderUnit };
}

type EventDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "YYYY-MM-DD" preselected (the day selected on the calendar). */
  date: string;
  /** "HH:MM" preselected (clicked hour in the day/week views). */
  startTime?: string;
  members: Member[];
  targets: Target[];
  /** Editing this event (null/undefined = creating a new one). */
  event?: CalendarEvent | null;
  canEdit?: boolean;
  onSubmit: (event: NewEvent) => Promise<void>;
  /** Only when editing. */
  onToggleCanceled?: (event: CalendarEvent) => Promise<void>;
  onDelete?: (event: CalendarEvent) => Promise<boolean>;
};

const pad = (value: number) => String(value).padStart(2, "0");
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

const plusOneHour = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

/** "Novo compromisso" form; with `event` it edits that event. */
export function EventDrawer({
  open,
  onOpenChange,
  date,
  startTime,
  members,
  targets,
  event: editing,
  canEdit = true,
  onSubmit,
  onToggleCanceled,
  onDelete,
}: EventDrawerProps) {
  const [draft, setDraft] = useState({
    title: "",
    date,
    start: "09:00",
    end: "10:00",
    assigneeId: "",
    targetId: "",
    description: "",
    reminderMessage: "",
    ...reminderFields(null),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      const startsAt = new Date(editing.startsAt);
      setDraft({
        title: editing.title,
        date: localDate(startsAt),
        start: localTime(startsAt),
        end: localTime(new Date(editing.endsAt)),
        assigneeId: editing.assignee?.id ?? "",
        targetId: editing.lead?.id ?? "",
        description: editing.description,
        reminderMessage: editing.reminderMessage ?? "",
        ...reminderFields(editing.reminderMinutesBefore),
      });
      return;
    }
    const start = startTime ?? "09:00";
    setDraft({
      title: "",
      date,
      start,
      end: plusOneHour(start),
      assigneeId: "",
      targetId: "",
      description: "",
      reminderMessage: "",
      ...reminderFields(null),
    });
    // Re-fill only when opening or switching events, not on every reload of the same one.
  }, [open, date, startTime, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAction(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The reminder goes to the lead: without one it's dropped.
    const reminderMessage = draft.targetId ? draft.reminderMessage.trim() : "";
    const reminderAmount = draft.targetId ? Number(draft.reminderAmount) : 0;
    if (Boolean(reminderMessage) !== reminderAmount > 0) {
      setError("Para o lembrete, informe a mensagem e quanto tempo antes do horário enviar.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        title: draft.title,
        description: draft.description,
        startsAt: new Date(`${draft.date}T${draft.start}`).toISOString(),
        endsAt: new Date(`${draft.date}T${draft.end}`).toISOString(),
        assigneeId: draft.assigneeId || null,
        targetId: draft.targetId || null,
        reminderMessage: reminderMessage || null,
        reminderMinutesBefore: reminderMessage
          ? Math.round(reminderAmount * UNIT_MINUTES[draft.reminderUnit])
          : null,
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <DrawerHeader>
            <DrawerTitle>{editing ? "Editar compromisso" : "Novo compromisso"}</DrawerTitle>
            <DrawerDescription className="flex flex-wrap items-center gap-2">
              {editing ? "Atualize os dados do compromisso." : "Agende uma reunião ou compromisso no calendário."}
              {editing?.source === "ai" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  <Bot className="h-3 w-3" />
                  Agendado pela IA
                </span>
              )}
              {editing?.status === "canceled" && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                  Cancelado
                </span>
              )}
            </DrawerDescription>
          </DrawerHeader>

          <fieldset disabled={!canEdit || saving} className="contents">

          <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <div className="space-y-2">
              <Label htmlFor="event-title">Título</Label>
              <Input
                id="event-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Ex.: Reunião de apresentação"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-date">Data</Label>
              <Input
                id="event-date"
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="event-start">Início</Label>
                <Input
                  id="event-start"
                  type="time"
                  value={draft.start}
                  onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-end">Fim</Label>
                <Input
                  id="event-end"
                  type="time"
                  value={draft.end}
                  onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-assignee">Responsável</Label>
              <OptionsSelect
                id="event-assignee"
                value={draft.assigneeId}
                onValueChange={(assigneeId) => setDraft({ ...draft, assigneeId })}
                options={[
                  { value: "", label: "Sem responsável" },
                  ...members.map((member) => ({
                    value: member.userId,
                    label: `${member.name}${member.acceptsEvents ? "" : " (não recebe eventos)"}`,
                  })),
                ]}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="event-lead">Lead</Label>
              <OptionsSelect
                id="event-lead"
                value={draft.targetId}
                onValueChange={(targetId) => setDraft({ ...draft, targetId })}
                options={[
                  { value: "", label: "Nenhum" },
                  ...targets.map((target) => ({ value: target.id, label: targetLabel(target) })),
                ]}
              />
            </div>
            {draft.targetId && (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="event-reminder-message" className="flex items-center gap-1.5">
                    <BellRing className="h-4 w-4" />
                    Lembrete para o lead
                  </Label>
                  {editing?.reminderSentAt && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      Enviado
                    </span>
                  )}
                </div>
                <Textarea
                  id="event-reminder-message"
                  value={draft.reminderMessage}
                  onChange={(e) => setDraft({ ...draft, reminderMessage: e.target.value })}
                  placeholder="Ex.: Olá! Passando para lembrar da nossa reunião hoje às 14h."
                  className="min-h-20"
                />
                <div className="space-y-2">
                  <Label htmlFor="event-reminder-amount">Enviar quanto tempo antes</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      id="event-reminder-amount"
                      type="number"
                      min={1}
                      step={1}
                      value={draft.reminderAmount}
                      onChange={(e) => setDraft({ ...draft, reminderAmount: e.target.value })}
                      placeholder="Ex.: 2"
                    />
                    <OptionsSelect
                      id="event-reminder-unit"
                      value={draft.reminderUnit}
                      onValueChange={(reminderUnit) => setDraft({ ...draft, reminderUnit: reminderUnit as ReminderUnit })}
                      options={[
                        { value: "minutes", label: "Minutos antes" },
                        { value: "hours", label: "Horas antes" },
                      ]}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enviada pelo WhatsApp ao lead. Deixe em branco para não enviar lembrete.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="event-description">Descrição</Label>
              <Textarea
                id="event-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="min-h-20"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          </fieldset>

          <DrawerFooter>
            {canEdit && (
              <Button type="submit" disabled={saving || !draft.title.trim()}>
                {saving ? "Salvando..." : editing ? "Salvar alterações" : "Agendar"}
              </Button>
            )}
            {editing?.lead && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/dashboard/lead/${editing.lead!.id}`);
                }}
              >
                <TargetIcon className="h-4 w-4" />
                Ver lead
              </Button>
            )}
            {canEdit && editing && onToggleCanceled && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void runAction(() => onToggleCanceled(editing))}
              >
                {editing.status === "canceled" ? <RotateCcw className="h-4 w-4" /> : <CalendarX className="h-4 w-4" />}
                {editing.status === "canceled" ? "Reativar compromisso" : "Cancelar compromisso"}
              </Button>
            )}
            {canEdit && editing && onDelete && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={saving}
                onClick={() =>
                  void runAction(async () => {
                    if (await onDelete(editing)) onOpenChange(false);
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </Button>
            )}
            <DrawerClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Fechar
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}
