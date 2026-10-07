import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  Filter,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { DEFAULT_SOURCE, leadName, type LeadCard, type Pipeline, type PipelineStage } from "@/lib/dashboard";
import type { Member } from "@/lib/organization";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import type { Target } from "@/lib/leads";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { AddLeadDrawer, LeadCardDrawer, type NewLead } from "@/components/dashboard/LeadDrawers";
import { LeadCardItem } from "@/components/dashboard/LeadCardItem";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";

const PIPELINE_STORAGE_KEY = "kanban:pipeline";
const TODAY_FORMAT = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" });

function readStoredPipeline() {
  try {
    return localStorage.getItem(PIPELINE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storePipeline(id: string) {
  try {
    localStorage.setItem(PIPELINE_STORAGE_KEY, id);
  } catch {
    // Private mode: just don't remember it.
  }
}

/** "quarta-feira, 29 de maio" -> "Quarta-feira, 29 de Maio" (as in the mock). */
function todayLabel() {
  return TODAY_FORMAT.format(new Date())
    .split(" ")
    .map((word) => (word === "de" ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

type SortMode = "manual" | "recent" | "oldest" | "name";

const SORT_LABELS: Record<SortMode, string> = {
  manual: "Posição no quadro",
  recent: "Mensagem mais recente",
  oldest: "Mensagem mais antiga",
  name: "Nome (A–Z)",
};

// "all" = everyone; "none" = cards without a responsible member.
const ALL_ASSIGNEES = "all";
const NO_ASSIGNEE = "none";

/** Dialog with a single name field (new pipeline / new column / rename). */
function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  initialValue = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  // Errors stay inside the dialog, which only closes once the save worked.
  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="name-dialog-input">{label}</Label>
            <Input
              id="name-dialog-input"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={saving}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !value.trim()}>
              {saving ? "Salvando..." : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type NameDialogState =
  | { kind: "pipeline" }
  | { kind: "rename-pipeline" }
  | { kind: "stage" }
  | { kind: "rename-stage"; stage: PipelineStage }
  | null;

type KanbanBoardProps = { canEdit: boolean };

export function KanbanBoard({ canEdit }: KanbanBoardProps) {
  const socket = useSocket();
  const navigate = useNavigate();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelineId, setPipelineId] = useState<string | null>(readStoredPipeline);
  const [cards, setCards] = useState<LeadCard[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState(ALL_ASSIGNEES);
  const [sort, setSort] = useState<SortMode>("manual");
  // "" = every origin.
  const [sourceFilter, setSourceFilter] = useState("");
  const [sources, setSources] = useState<string[]>([DEFAULT_SOURCE]);

  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  const [dropStageId, setDropStageId] = useState<string | null>(null);

  // Column whose "+" (or "Novo Lead") was clicked (null = drawer closed).
  const [addLeadStageId, setAddLeadStageId] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);

  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0] ?? null;

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadPipelines = useCallback(async () => {
    const list = await api<Pipeline[]>("/api/dashboard/kanban/pipelines");
    setPipelines(list);
    return list;
  }, []);

  const loadCards = useCallback(async (id: string | null) => {
    if (!id) return setCards([]);
    setCards(await api<LeadCard[]>(`/api/dashboard/kanban/pipelines/${id}/cards`));
    setLoadedAt(Date.now());
  }, []);

  useEffect(() => {
    Promise.all([loadPipelines(), api<Member[]>("/api/organizations/current/members").then(setMembers)])
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [loadPipelines]);

  useEffect(() => {
    if (pipeline) storePipeline(pipeline.id);
    void run(() => loadCards(pipeline?.id ?? null));
  }, [pipeline?.id, loadCards, run]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another user (or the AI agent) changed the board.
  useEffect(() => {
    function onUpdated() {
      void loadPipelines().catch(() => {});
      void loadCards(pipeline?.id ?? null).catch(() => {});
    }
    socket.on("kanban:updated", onUpdated);
    return () => {
      socket.off("kanban:updated", onUpdated);
    };
  }, [socket, loadPipelines, loadCards, pipeline?.id]);

  // Keeps "Atualizado há X min" and the cards' "X min atrás" current.
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const filtering = Boolean(search.trim()) || assigneeFilter !== ALL_ASSIGNEES || sourceFilter !== "";

  // Toolbar chips: WhatsApp plus every origin present on this board.
  const boardSources = useMemo(() => {
    const seen = new Map<string, string>([[DEFAULT_SOURCE.toLowerCase(), DEFAULT_SOURCE]]);
    for (const card of cards) if (!seen.has(card.source.toLowerCase())) seen.set(card.source.toLowerCase(), card.source);
    return [...seen.values()];
  }, [cards]);

  const visibleCards = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    return cards.filter((card) => {
      if (sourceFilter && card.source.toLowerCase() !== sourceFilter.toLowerCase()) return false;
      if (assigneeFilter === NO_ASSIGNEE && card.assignee) return false;
      if (assigneeFilter !== ALL_ASSIGNEES && assigneeFilter !== NO_ASSIGNEE && card.assignee?.id !== assigneeFilter) {
        return false;
      }
      if (!term) return true;
      return (
        leadName(card.lead).toLowerCase().includes(term) ||
        (digits.length > 0 && (card.lead.number ?? "").includes(digits))
      );
    });
  }, [cards, search, assigneeFilter, sourceFilter]);

  const cardsByStage = useMemo(() => {
    const time = (card: LeadCard) => (card.lead.lastMessageAt ? new Date(card.lead.lastMessageAt).getTime() : 0);
    const compare: Record<SortMode, (a: LeadCard, b: LeadCard) => number> = {
      manual: (a, b) => a.position - b.position,
      recent: (a, b) => time(b) - time(a),
      oldest: (a, b) => time(a) - time(b),
      name: (a, b) => leadName(a.lead).localeCompare(leadName(b.lead), "pt-BR"),
    };
    const map = new Map<string, LeadCard[]>();
    for (const card of visibleCards) map.set(card.stageId, [...(map.get(card.stageId) ?? []), card]);
    for (const list of map.values()) list.sort(compare[sort]);
    return map;
  }, [visibleCards, sort]);

  // ---- Pipelines / stages ---------------------------------------------------

  async function createPipeline(name: string) {
    const list = await api<Pipeline[]>("/api/dashboard/kanban/pipelines", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setPipelines(list);
    setPipelineId(list[list.length - 1]?.id ?? null);
  }

  async function renamePipeline(name: string) {
    setPipelines(
      await api<Pipeline[]>(`/api/dashboard/kanban/pipelines/${pipeline!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    );
  }

  async function deletePipeline() {
    if (!pipeline || !confirm(`Excluir a esteira "${pipeline.name}"? Os leads saem do quadro (continuam em Leads).`)) {
      return;
    }
    await run(async () => {
      const list = await api<Pipeline[]>(`/api/dashboard/kanban/pipelines/${pipeline.id}`, { method: "DELETE" });
      setPipelines(list);
      setPipelineId(list[0]?.id ?? null);
    });
  }

  async function createStage(name: string) {
    setPipelines(
      await api<Pipeline[]>(`/api/dashboard/kanban/pipelines/${pipeline!.id}/stages`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    );
  }

  async function saveStage(stage: PipelineStage, patch: { name?: string; color?: string }) {
    setPipelines(
      await api<Pipeline[]>(`/api/dashboard/kanban/stages/${stage.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    );
  }

  async function deleteStage(stage: PipelineStage) {
    if (!confirm(`Excluir a coluna "${stage.name}"?`)) return;
    await run(async () =>
      setPipelines(await api<Pipeline[]>(`/api/dashboard/kanban/stages/${stage.id}`, { method: "DELETE" })),
    );
  }

  async function moveStage(index: number, direction: -1 | 1) {
    if (!pipeline) return;
    const ids = pipeline.stages.map((stage) => stage.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await run(async () =>
      setPipelines(
        await api<Pipeline[]>(`/api/dashboard/kanban/pipelines/${pipeline.id}/stages/order`, {
          method: "PUT",
          body: JSON.stringify({ stageIds: ids }),
        }),
      ),
    );
  }

  // ---- Cards ----------------------------------------------------------------

  async function moveCard(cardId: string, stageId: string, position: number) {
    // Optimistic: put the card in place right away, then reload the column order.
    setCards((current) => {
      const moving = current.find((card) => card.id === cardId);
      if (!moving) return current;
      const others = current.filter((card) => card.id !== cardId);
      const column = others.filter((card) => card.stageId === stageId).sort((a, b) => a.position - b.position);
      column.splice(position, 0, { ...moving, stageId });
      const positions = new Map(column.map((card, index) => [card.id, index]));
      return [
        ...others.filter((card) => card.stageId !== stageId),
        ...column.map((card) => ({ ...card, position: positions.get(card.id)! })),
      ];
    });
    await run(async () => {
      await api(`/api/dashboard/kanban/cards/${cardId}`, {
        method: "PATCH",
        body: JSON.stringify({ stageId, position }),
      });
      await loadCards(pipeline?.id ?? null);
    });
  }

  const columnSize = (stageId: string, except?: string) =>
    cards.filter((card) => card.stageId === stageId && card.id !== except).length;

  function handleDrop(event: DragEvent, stageId: string, beforeCardId?: string) {
    event.preventDefault();
    event.stopPropagation();
    setDropStageId(null);
    const cardId = dragCardId ?? event.dataTransfer.getData("text/plain");
    setDragCardId(null);
    if (!cardId || cardId === beforeCardId) return;

    // With a sort or filter on, the visible order isn't the saved one: append to the column.
    if (sort !== "manual" || filtering || !beforeCardId) {
      return void moveCard(cardId, stageId, columnSize(stageId, cardId));
    }
    const column = cards
      .filter((card) => card.stageId === stageId && card.id !== cardId)
      .sort((a, b) => a.position - b.position);
    const index = column.findIndex((card) => card.id === beforeCardId);
    void moveCard(cardId, stageId, index === -1 ? column.length : index);
  }

  const assign = (card: LeadCard, assigneeId: string) =>
    run(async () => {
      await api(`/api/dashboard/kanban/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify({ assigneeId: assigneeId || null }),
      });
      await loadCards(pipeline?.id ?? null);
    });

  async function removeCard(card: LeadCard) {
    if (!confirm(`Apagar o card de "${leadName(card.lead)}"? O lead continua em Leads.`)) return;
    await run(async () => {
      await api(`/api/dashboard/kanban/cards/${card.id}`, { method: "DELETE" });
      setOpenCardId(null);
      setCards((current) => current.filter((c) => c.id !== card.id));
    });
  }

  async function openAddLead(stageId: string) {
    setAddLeadStageId(stageId);
    await run(async () => {
      const [targetList, sourceList] = await Promise.all([
        api<Target[]>("/api/whatsapp/targets"),
        api<string[]>("/api/dashboard/kanban/sources"),
      ]);
      setTargets(targetList);
      setSources(sourceList);
    });
  }

  async function addLead(lead: NewLead) {
    setError(null);
    try {
      await api("/api/dashboard/kanban/cards", { method: "POST", body: JSON.stringify(lead) });
      await loadCards(pipeline?.id ?? null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  // Errors are thrown so the drawer field shows them.
  async function changeSource(card: LeadCard, source: string) {
    const updated = await api<LeadCard>(`/api/dashboard/kanban/cards/${card.id}`, {
      method: "PATCH",
      body: JSON.stringify({ source }),
    });
    setCards((current) => current.map((c) => (c.id === updated.id ? updated : c)));
  }

  // Origin suggestions for the drawer of the opened card.
  useEffect(() => {
    if (!openCardId) return;
    api<string[]>("/api/dashboard/kanban/sources")
      .then(setSources)
      .catch(() => {});
  }, [openCardId]);

  function openChat(card: LeadCard) {
    navigate("/dashboard/conversas", {
      state: { initialChatId: card.lead.chatId, initialLabel: leadName(card.lead) },
    });
  }

  // The opened card follows reloads (moves, new responsible).
  const openCard = cards.find((card) => card.id === openCardId) ?? null;

  // ---- Render ---------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }

  const updatedMinutes = loadedAt ? Math.floor((Date.now() - loadedAt) / 60_000) : null;
  const shownMembers = members.slice(0, 3);
  const nameDialogProps =
    nameDialog?.kind === "pipeline"
      ? { title: "Nova esteira", label: "Nome da esteira", placeholder: "Ex.: Vendas", submitLabel: "Criar esteira", onSubmit: createPipeline }
      : nameDialog?.kind === "rename-pipeline"
        ? { title: "Renomear esteira", label: "Nome da esteira", initialValue: pipeline?.name, submitLabel: "Salvar", onSubmit: renamePipeline }
        : nameDialog?.kind === "stage"
          ? {
              title: "Nova coluna",
              description: pipeline ? `Adicionar uma etapa à esteira "${pipeline.name}".` : undefined,
              label: "Nome da etapa",
              placeholder: "Ex.: Proposta enviada",
              submitLabel: "Criar coluna",
              onSubmit: createStage,
            }
          : nameDialog?.kind === "rename-stage"
            ? {
                title: "Renomear coluna",
                label: "Nome da etapa",
                initialValue: nameDialog.stage.name,
                submitLabel: "Salvar",
                onSubmit: (name: string) => saveStage(nameDialog.stage, { name }),
              }
            : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
      {/* Header: pipeline, date/count, search, team and "Novo Lead". */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            {pipelines.length > 0 ? (
              <Select value={pipeline?.id ?? ""} onValueChange={setPipelineId}>
                <SelectTrigger
                  className="h-auto w-auto gap-1 border-0 p-0 text-xl font-semibold shadow-none focus-visible:ring-0"
                  aria-label="Esteira"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <h2 className="text-xl font-semibold">Quadro</h2>
            )}
            {canEdit && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Ações da esteira"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => setNameDialog({ kind: "pipeline" })}>
                    <Plus />
                    Nova esteira
                  </DropdownMenuItem>
                  {pipeline && (
                    <>
                      <DropdownMenuItem onSelect={() => setNameDialog({ kind: "rename-pipeline" })}>
                        <Pencil />
                        Renomear esteira
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void deletePipeline()}>
                        <Trash2 />
                        Excluir esteira
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {todayLabel()} · {cards.length} {cards.length === 1 ? "lead ativo" : "leads ativos"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar lead..."
              className="h-9 w-56 bg-muted/40 pl-9"
              aria-label="Buscar lead"
            />
          </div>
          {members.length > 0 && (
            <div className="flex -space-x-2" title={members.map((m) => m.name).join(", ")}>
              {shownMembers.map((member) => (
                <MemberAvatar
                  key={member.userId}
                  id={member.userId}
                  name={member.name}
                  image={member.image}
                  className="h-8 w-8"
                />
              ))}
              {members.length > shownMembers.length && (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium ring-2 ring-background">
                  +{members.length - shownMembers.length}
                </span>
              )}
            </div>
          )}
          {canEdit && pipeline && (
            <Button onClick={() => void openAddLead(pipeline.stages[0]?.id ?? "")} disabled={!pipeline.stages.length}>
              <Plus className="h-4 w-4" />
              Novo Lead
            </Button>
          )}
          {canEdit && !pipeline && (
            <Button onClick={() => setNameDialog({ kind: "pipeline" })}>
              <Plus className="h-4 w-4" />
              Nova esteira
            </Button>
          )}
        </div>
      </div>

      {/* Toolbar: responsible filter, sort, channel and last update. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger
            size="sm"
            className={cn("w-auto gap-2 text-sm", assigneeFilter !== ALL_ASSIGNEES && "border-primary text-primary")}
            aria-label="Filtrar por responsável"
          >
            <Filter className="h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_ASSIGNEES}>Filtros</SelectItem>
            <SelectItem value={NO_ASSIGNEE}>Sem responsável</SelectItem>
            {members.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sort} onValueChange={(value) => setSort(value as SortMode)}>
          <SelectTrigger size="sm" className="w-auto gap-2 text-sm" aria-label="Ordenar">
            <ArrowDownUp className="h-4 w-4" />
            {sort === "manual" ? <span>Ordenar</span> : <SelectValue />}
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
              <SelectItem key={mode} value={mode}>
                {SORT_LABELS[mode]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="mx-1 h-6 w-px bg-border" />

        {[["", "Todos"] as const, ...boardSources.map((source) => [source, source] as const)].map(([value, label]) => (
          <button
            key={value || "all"}
            type="button"
            onClick={() => setSourceFilter(value)}
            className={cn(
              "h-8 rounded-md border px-3 text-sm font-medium transition-colors",
              sourceFilter.toLowerCase() === value.toLowerCase()
                ? "border-primary/20 bg-primary/10 text-primary"
                : "bg-background hover:bg-accent hover:text-accent-foreground",
            )}
          >
            {label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          {updatedMinutes !== null && (
            <span>
              Atualizado{" "}
              <span className="font-medium text-foreground">
                {updatedMinutes < 1 ? "agora" : `há ${updatedMinutes} min`}
              </span>
            </span>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void run(() => loadCards(pipeline?.id ?? null))}
            aria-label="Atualizar"
            title="Atualizar"
          >
            <History className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && <p className="shrink-0 border-b px-6 py-2 text-sm text-destructive">{error}</p>}

      {/* Columns fill the remaining height; each one scrolls its cards. */}
      <div className="flex min-h-0 flex-1 overflow-x-auto bg-muted/30">
        {!pipeline && (
          <p className="m-auto text-sm text-muted-foreground">
            Nenhuma esteira ainda.{canEdit ? " Crie a primeira para organizar seus leads." : ""}
          </p>
        )}

        {pipeline?.stages.map((stage, index) => {
          const column = cardsByStage.get(stage.id) ?? [];
          return (
            <div
              key={stage.id}
              onDragOver={(event) => {
                if (!canEdit) return;
                event.preventDefault();
                setDropStageId(stage.id);
              }}
              onDragLeave={() => setDropStageId((current) => (current === stage.id ? null : current))}
              onDrop={(event) => canEdit && handleDrop(event, stage.id)}
              className={cn(
                "flex h-full min-h-0 w-[280px] shrink-0 flex-col border-r transition-colors",
                dropStageId === stage.id && "bg-primary/5",
              )}
            >
              <div className="group flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
                {/* Clicking the dot changes the column color. */}
                <label
                  className={cn("relative h-2.5 w-2.5 shrink-0 rounded-full", canEdit && "cursor-pointer")}
                  style={{ background: stage.color }}
                  title={canEdit ? "Mudar cor" : undefined}
                >
                  {canEdit && (
                    <input
                      type="color"
                      value={stage.color}
                      onChange={(e) => void run(() => saveStage(stage, { color: e.target.value }))}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      aria-label={`Cor da coluna ${stage.name}`}
                    />
                  )}
                </label>
                <span className="truncate text-sm font-semibold">{stage.name}</span>
                <span className="rounded-full border bg-background px-2 text-xs font-medium text-muted-foreground">
                  {column.length}
                </span>
                {canEdit && (
                  <div className="ml-auto flex items-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                          aria-label={`Ações da coluna ${stage.name}`}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setNameDialog({ kind: "rename-stage", stage })}>
                          <Pencil />
                          Renomear
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Mover coluna</DropdownMenuLabel>
                        <DropdownMenuItem disabled={index === 0} onSelect={() => void moveStage(index, -1)}>
                          <ChevronLeft />
                          Para a esquerda
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === pipeline.stages.length - 1}
                          onSelect={() => void moveStage(index, 1)}
                        >
                          <ChevronRight />
                          Para a direita
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => void deleteStage(stage)}>
                          <Trash2 />
                          Excluir coluna
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <button
                      type="button"
                      onClick={() => void openAddLead(stage.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Adicionar lead em ${stage.name}`}
                      title="Adicionar lead"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-4 pt-1">
                {column.map((card) => (
                  <LeadCardItem
                    key={card.id}
                    card={card}
                    canEdit={canEdit}
                    dragging={dragCardId === card.id}
                    onOpen={() => setOpenCardId(card.id)}
                    onOpenChat={() => openChat(card)}
                    onRemove={() => void removeCard(card)}
                    onDragStart={(event) => {
                      setDragCardId(card.id);
                      event.dataTransfer.setData("text/plain", card.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setDragCardId(null);
                      setDropStageId(null);
                    }}
                    onDrop={(event) => canEdit && handleDrop(event, stage.id, card.id)}
                  />
                ))}
                {column.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {filtering ? "Nenhum lead encontrado" : canEdit ? "Arraste leads para cá" : "Nenhum lead"}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {canEdit && pipeline && (
          <div className="shrink-0 p-4">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-10 w-10 border-dashed bg-transparent"
              onClick={() => setNameDialog({ kind: "stage" })}
              title="Nova coluna"
              aria-label="Nova coluna"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {nameDialogProps && (
        <NameDialog
          open={nameDialog !== null}
          onOpenChange={(open) => !open && setNameDialog(null)}
          {...nameDialogProps}
        />
      )}

      {pipeline && (
        <>
          <AddLeadDrawer
            open={addLeadStageId !== null}
            onOpenChange={(open) => !open && setAddLeadStageId(null)}
            pipelineName={pipeline.name}
            stages={pipeline.stages}
            initialStageId={addLeadStageId}
            targets={targets}
            members={members}
            sources={sources}
            onSubmit={addLead}
          />

          <LeadCardDrawer
            card={openCard}
            onOpenChange={(open) => !open && setOpenCardId(null)}
            stages={pipeline.stages}
            members={members}
            canEdit={canEdit}
            onMove={(card, stageId) => void moveCard(card.id, stageId, columnSize(stageId, card.id))}
            onAssign={(card, assigneeId) => void assign(card, assigneeId)}
            onRemove={(card) => void removeCard(card)}
            onOpenChat={openChat}
            sources={sources}
            onSourceChange={changeSource}
          />
        </>
      )}
    </div>
  );
}
