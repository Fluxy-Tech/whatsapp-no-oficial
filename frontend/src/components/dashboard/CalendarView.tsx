import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarDays, ChevronLeft, ChevronRight, CirclePlus, Trash2, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { leadName, type CalendarEvent } from "@/lib/dashboard";
import type { Member } from "@/lib/organization";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import type { Target } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import { EventDrawer, type NewEvent } from "@/components/dashboard/EventDrawer";
import { AttentionDot } from "@/components/ui/attention-dot";

type ViewMode = "day" | "week" | "month";

const VIEW_LABELS: Record<ViewMode, string> = { day: "Dia", week: "Semana", month: "Mês" };
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const HOUR_HEIGHT = 56;

const TIME_FORMAT = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("pt-BR", { weekday: "long" });
const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });

const pad = (value: number) => String(value).padStart(2, "0");
/** Local "YYYY-MM-DD" (the calendar works in the browser's timezone). */
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const startOfWeek = (date: Date) => addDays(date, -date.getDay());
/** "outubro de 2026" -> "Outubro de 2026". */
const capitalize = (text: string) =>
  text
    .split(" ")
    .map((word) => (["de", "da", "do"].includes(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");

/** 6 weeks starting on the Sunday before the 1st of the month. */
function monthGrid(month: Date) {
  const start = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function headerLabel(view: ViewMode, day: Date) {
  if (view === "month") return capitalize(MONTH_YEAR.format(day));
  if (view === "day") return capitalize(`${WEEKDAY_LONG.format(day)}, ${DAY_MONTH.format(day)}`);
  const start = startOfWeek(day);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.getDate()} – ${end.getDate()} de ${capitalize(MONTH_YEAR.format(end))}`
    : `${start.getDate()} ${capitalize(DAY_MONTH.format(start).split(" de ")[1])} – ${end.getDate()} de ${capitalize(MONTH_YEAR.format(end))}`;
}

/** Side-by-side lanes for overlapping events of one day (time grid views). */
function layoutDay(events: CalendarEvent[]) {
  const sorted = [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const lanes: number[] = [];
  const placed = sorted.map((event) => {
    const start = new Date(event.startsAt).getTime();
    let lane = lanes.findIndex((end) => end <= start);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = new Date(event.endsAt).getTime();
    return { event, lane };
  });
  return placed.map((item) => ({ ...item, lanes: Math.max(lanes.length, 1) }));
}

/** Scheduled events nobody will attend get an attention dot. */
const needsAssignee = (event: CalendarEvent) => !event.assignee && event.status !== "canceled";

type CalendarViewProps = { canEdit: boolean };

export function CalendarView({ canEdit }: CalendarViewProps) {
  const socket = useSocket();
  const [view, setView] = useState<ViewMode>("month");
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [error, setError] = useState<string | null>(null);
  // New event (date/startTime) or editing an existing one (eventId).
  const [drawer, setDrawer] = useState<{ date: string; startTime?: string; eventId?: string } | null>(null);
  const timeGridRef = useRef<HTMLDivElement>(null);

  // Every view fits inside the 6-week grid of the selected month: load it all.
  const grid = useMemo(() => monthGrid(selected), [selected.getFullYear(), selected.getMonth()]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadEvents = useCallback(async () => {
    const query = new URLSearchParams({
      from: grid[0].toISOString(),
      to: addDays(grid[grid.length - 1], 1).toISOString(),
    });
    setEvents(await api<CalendarEvent[]>(`/api/dashboard/calendar/events?${query}`));
  }, [grid]);

  useEffect(() => {
    loadEvents().catch((err) => setError((err as Error).message));
  }, [loadEvents]);

  useEffect(() => {
    api<Member[]>("/api/organizations/current/members").then(setMembers).catch(() => {});
    api<Target[]>("/api/whatsapp/targets").then(setTargets).catch(() => {});
  }, []);

  // Meetings booked by the AI agent (or by another user) show up live.
  useEffect(() => {
    const onUpdated = () => void loadEvents().catch(() => {});
    socket.on("calendar:updated", onUpdated);
    return () => {
      socket.off("calendar:updated", onUpdated);
    };
  }, [socket, loadEvents]);

  // Day/week views open around business hours.
  useEffect(() => {
    if (view !== "month" && timeGridRef.current) timeGridRef.current.scrollTop = HOUR_HEIGHT * 7.5;
  }, [view]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const key = dayKey(new Date(event.startsAt));
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    for (const list of map.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return map;
  }, [events]);

  const today = dayKey(new Date());
  const selectedKey = dayKey(selected);
  const selectedEvents = eventsByDay.get(selectedKey) ?? [];
  const activeEvents = (list: CalendarEvent[]) => list.filter((event) => event.status !== "canceled");

  const weekSummary = useMemo(() => {
    const start = startOfWeek(selected);
    const week = Array.from({ length: 7 }, (_, i) => eventsByDay.get(dayKey(addDays(start, i))) ?? []).flat();
    return {
      total: week.filter((event) => event.status !== "canceled").length,
      byAi: week.filter((event) => event.status !== "canceled" && event.source === "ai").length,
      canceled: week.filter((event) => event.status === "canceled").length,
    };
  }, [eventsByDay, selected]);

  function navigate(direction: -1 | 1) {
    setSelected((current) => {
      if (view === "day") return addDays(current, direction);
      if (view === "week") return addDays(current, 7 * direction);
      // Same day number in the next/previous month (clamped to its length).
      const target = new Date(current.getFullYear(), current.getMonth() + direction, 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      return new Date(target.getFullYear(), target.getMonth(), Math.min(current.getDate(), lastDay));
    });
  }

  async function createEvent(event: NewEvent) {
    await api("/api/dashboard/calendar/events", { method: "POST", body: JSON.stringify(event) });
    setSelected(startOfDay(new Date(event.startsAt)));
    await loadEvents();
  }

  async function updateEvent(eventId: string, event: NewEvent) {
    await api(`/api/dashboard/calendar/events/${eventId}`, { method: "PATCH", body: JSON.stringify(event) });
    setSelected(startOfDay(new Date(event.startsAt)));
    await loadEvents();
  }

  // Errors are thrown: the drawer shows them; the side panel uses `withError`.
  async function toggleCanceled(calendarEvent: CalendarEvent) {
    await api(`/api/dashboard/calendar/events/${calendarEvent.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: calendarEvent.status === "canceled" ? "scheduled" : "canceled" }),
    });
    await loadEvents();
  }

  /** false when the user gave up on the confirmation. */
  async function remove(calendarEvent: CalendarEvent) {
    if (!confirm(`Excluir "${calendarEvent.title}"?`)) return false;
    await api(`/api/dashboard/calendar/events/${calendarEvent.id}`, { method: "DELETE" });
    await loadEvents();
    return true;
  }

  async function withError(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const openNew = (date = selectedKey, startTime?: string) => canEdit && setDrawer({ date, startTime });
  // Everyone who can see the calendar can open an event; only editors can change it.
  const openEvent = (event: CalendarEvent) =>
    setDrawer({ date: dayKey(new Date(event.startsAt)), eventId: event.id });
  const editingEvent = drawer?.eventId ? (events.find((event) => event.id === drawer.eventId) ?? null) : null;

  // ---- Views ----------------------------------------------------------------
  // Plain render functions (not components): the time grid keeps its scroll
  // position across re-renders instead of being remounted.

  function renderPill(event: CalendarEvent) {
    return (
      <span
        key={event.id}
        role="button"
        tabIndex={0}
        onClick={(clickEvent) => {
          clickEvent.stopPropagation();
          openEvent(event);
        }}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === "Enter") {
            keyEvent.stopPropagation();
            openEvent(event);
          }
        }}
        className={cn(
          "flex items-center gap-1 rounded-sm border-l-[3px] hover:bg-primary/20 border-primary bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-foreground",
          event.status === "canceled" && "border-muted-foreground/40 bg-muted text-muted-foreground line-through",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {TIME_FORMAT.format(new Date(event.startsAt))} {event.title}
        </span>
        {needsAssignee(event) && <AttentionDot className="h-2 w-2" label="Agenda sem responsável" />}
      </span>
    );
  }

  function renderMonth() {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
        <div className="grid shrink-0 grid-cols-7 border-b bg-muted/40">
          {WEEKDAYS.map((weekday) => (
            <div key={weekday} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {weekday}
            </div>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
          {grid.map((day) => {
            const key = dayKey(day);
            const dayEvents = eventsByDay.get(key) ?? [];
            const inMonth = day.getMonth() === selected.getMonth();
            const isSelected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(day)}
                onDoubleClick={() => openNew(key)}
                className={cn(
                  "flex min-h-0 flex-col gap-1 overflow-hidden border-b border-r p-2 text-left transition-colors hover:bg-accent/40 [&:nth-child(7n)]:border-r-0",
                  !inMonth && "bg-muted/40",
                  isSelected && "bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm",
                    !inMonth && "text-muted-foreground/50",
                    key === today && "bg-primary font-semibold text-primary-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
                {dayEvents.slice(0, 3).map(renderPill)}
                {dayEvents.length > 3 && (
                  <span className="px-1 text-[11px] text-muted-foreground">+{dayEvents.length - 3} mais</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderTimeGrid(days: Date[]) {
    const now = new Date();
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
        <div className="flex shrink-0 border-b bg-muted/40">
          <div className="w-14 shrink-0" />
          {days.map((day) => {
            const key = dayKey(day);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(day)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-0.5 border-l py-2",
                  key === selectedKey && "bg-primary/5",
                )}
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {WEEKDAYS[day.getDay()]}
                </span>
                <span
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium",
                    key === today && "bg-primary text-primary-foreground",
                  )}
                >
                  {day.getDate()}
                </span>
              </button>
            );
          })}
        </div>

        <div ref={timeGridRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="relative flex" style={{ height: HOUR_HEIGHT * 24 }}>
            <div className="w-14 shrink-0">
              {HOURS.map((hour) => (
                <div key={hour} className="relative text-right" style={{ height: HOUR_HEIGHT }}>
                  {hour > 0 && (
                    <span className="absolute -top-2 right-2 text-[11px] text-muted-foreground">{pad(hour)}:00</span>
                  )}
                </div>
              ))}
            </div>

            {days.map((day) => {
              const key = dayKey(day);
              const laidOut = layoutDay(eventsByDay.get(key) ?? []);
              return (
                <div key={key} className={cn("relative flex-1 border-l", key === selectedKey && "bg-primary/[0.03]")}>
                  {HOURS.map((hour) => (
                    <button
                      key={hour}
                      type="button"
                      onClick={() => {
                        setSelected(day);
                        openNew(key, `${pad(hour)}:00`);
                      }}
                      className="block w-full border-b border-border/60 hover:bg-accent/40"
                      style={{ height: HOUR_HEIGHT }}
                      aria-label={`Agendar ${pad(hour)}:00`}
                    />
                  ))}

                  {laidOut.map(({ event, lane, lanes }) => {
                    const start = new Date(event.startsAt);
                    const end = new Date(event.endsAt);
                    const top = (start.getHours() + start.getMinutes() / 60) * HOUR_HEIGHT;
                    const height = Math.max(((end.getTime() - start.getTime()) / 3_600_000) * HOUR_HEIGHT, 22);
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => {
                          setSelected(day);
                          openEvent(event);
                        }}
                        className={cn(
                          "absolute overflow-hidden rounded-md border-l-[3px] border-primary bg-primary/10 px-2 py-1 text-left text-xs hover:bg-primary/20",
                          event.status === "canceled" && "border-muted-foreground/40 bg-muted text-muted-foreground line-through",
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${(lane / lanes) * 100}% + 2px)`,
                          width: `calc(${100 / lanes}% - 4px)`,
                        }}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate font-semibold">{event.title}</span>
                          {needsAssignee(event) && <AttentionDot className="h-2 w-2" label="Agenda sem responsável" />}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {TIME_FORMAT.format(start)} – {TIME_FORMAT.format(end)}
                        </span>
                      </button>
                    );
                  })}

                  {key === today && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary"
                      style={{ top: (now.getHours() + now.getMinutes() / 60) * HOUR_HEIGHT }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(selected), i));
  const dayTitle = capitalize(`${WEEKDAY_LONG.format(selected)}, ${selected.getDate()}`).replace(/-(\w)/, (_, c: string) => `-${c.toUpperCase()}`);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
      {/* Header: title, navigation, view switcher and "Agendar". */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-3">
        <div className="flex flex-wrap items-center gap-4">
          <h2 className="text-lg font-semibold">Calendário</h2>
          <span className="h-6 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(-1)} aria-label="Anterior">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold">{headerLabel(view, selected)}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navigate(1)} aria-label="Próximo">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => setSelected(startOfDay(new Date()))}>
              Hoje
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border bg-muted/50 p-1" role="tablist" aria-label="Visualização">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={view === mode}
                onClick={() => setView(mode)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                  view === mode ? "bg-background text-primary shadow-xs" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {VIEW_LABELS[mode]}
              </button>
            ))}
          </div>
          {canEdit && (
            <Button onClick={() => openNew()}>
              <CirclePlus className="h-4 w-4" />
              Agendar
            </Button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Calendar */}
        <div className="min-h-0 min-w-0 flex-1 p-4">
          {view === "month" && renderMonth()}
          {view === "week" && renderTimeGrid(weekDays)}
          {view === "day" && renderTimeGrid([selected])}
        </div>

        {/* Selected day + week summary */}
        <aside className="flex w-80 shrink-0 flex-col border-l">
          <div className="border-b px-5 py-4">
            <p className="text-lg font-semibold">{dayTitle}</p>
            <p className="text-sm text-muted-foreground">{capitalize(MONTH_YEAR.format(selected))}</p>
            <span className="mt-2 inline-block rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              {activeEvents(selectedEvents).length} {activeEvents(selectedEvents).length === 1 ? "evento" : "eventos"}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
            {selectedEvents.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                  <CalendarDays className="h-7 w-7 text-muted-foreground" />
                </span>
                <p className="text-sm font-semibold">Nada agendado</p>
                <p className="max-w-52 text-xs text-muted-foreground">
                  Não há nenhum evento ou compromisso para este dia.
                </p>
                {canEdit && (
                  <Button
                    variant="outline"
                    className="mt-3 w-full border-primary/20 bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary"
                    onClick={() => openNew()}
                  >
                    Novo Compromisso
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {selectedEvents.map((event) => (
                  <div
                    key={event.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openEvent(event)}
                    onKeyDown={(keyEvent) => keyEvent.key === "Enter" && openEvent(event)}
                    className={cn(
                      "cursor-pointer space-y-1 rounded-md border-l-[3px] border-primary bg-primary/5 p-3 transition-colors hover:bg-primary/10",
                      event.status === "canceled" && "border-muted-foreground/40 bg-muted/50 opacity-70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-sm font-semibold", event.status === "canceled" && "line-through")}>
                        {event.title}
                      </p>
                      {event.source === "ai" && (
                        <span className="flex shrink-0 items-center gap-1 rounded bg-background px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                          <Bot className="h-3 w-3" />
                          IA
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {TIME_FORMAT.format(new Date(event.startsAt))} – {TIME_FORMAT.format(new Date(event.endsAt))}
                      {event.status === "canceled" ? " · cancelado" : ""}
                    </p>
                    <p
                      className={cn(
                        "flex items-center gap-1.5 text-xs text-muted-foreground",
                        needsAssignee(event) && "font-medium text-red-600",
                      )}
                    >
                      {needsAssignee(event) ? (
                        <AttentionDot className="h-2 w-2" />
                      ) : (
                        <UserRound className="h-3 w-3" />
                      )}
                      {event.assignee?.name ?? "Sem responsável"}
                    </p>
                    {event.lead && <p className="text-xs">Lead: {leadName(event.lead)}</p>}
                    {event.description && (
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">{event.description}</p>
                    )}
                    {canEdit && (
                      <div className="flex gap-2 pt-1" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => void withError(() => toggleCanceled(event))}
                        >
                          {event.status === "canceled" ? "Reativar" : "Cancelar"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-destructive"
                          onClick={() => void withError(() => remove(event))}
                        >
                          <Trash2 className="h-3 w-3" />
                          Excluir
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <Button
                    variant="outline"
                    className="w-full border-primary/20 bg-primary/10 font-semibold text-primary hover:bg-primary/15 hover:text-primary"
                    onClick={() => openNew()}
                  >
                    Novo Compromisso
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t bg-muted/30 px-5 py-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Resumo da semana
            </p>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt>Total de agendamentos</dt>
                <dd className="font-semibold text-primary">{weekSummary.total}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Agendados pela IA</dt>
                <dd className="font-semibold text-emerald-600">{weekSummary.byAi}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Cancelados</dt>
                <dd className="font-semibold text-amber-600">{weekSummary.canceled}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <EventDrawer
        open={drawer !== null}
        onOpenChange={(open) => !open && setDrawer(null)}
        date={drawer?.date ?? selectedKey}
        startTime={drawer?.startTime}
        members={members}
        targets={targets}
        event={editingEvent}
        canEdit={canEdit}
        onSubmit={(event) => (editingEvent ? updateEvent(editingEvent.id, event) : createEvent(event))}
        onToggleCanceled={toggleCanceled}
        onDelete={remove}
      />
    </div>
  );
}
