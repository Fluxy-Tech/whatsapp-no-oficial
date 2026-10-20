import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Bot, CalendarClock, ChevronRight, FileText, ListChecks, Plus, Sparkles, Star } from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, AgentsResponse } from "@/lib/agents";
import { cn } from "@/lib/utils";
import { usePermission } from "@/providers/OrganizationProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { StatTile } from "@/components/ui/stat-tile";

/** Dot + label: inactive, active without prompt (can't answer) or ready. */
function agentState(agent: Agent) {
  if (!agent.active) return { label: "Inativo", dot: "bg-muted-foreground/40" };
  if (!agent.context.trim()) return { label: "Sem prompt", dot: "bg-amber-500" };
  return { label: "Ativo", dot: "bg-emerald-500" };
}

/** /dashboard/agentes: every agent of the organization; a click opens /dashboard/agentes/{id}. */
export function AgentsPage() {
  const navigate = useNavigate();
  const { canEdit } = usePermission("agentes");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AgentsResponse>("/api/agents")
      .then((response) => setAgents(response.agents))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const inUse = agents.find((agent) => agent.isOrganizationAgent) ?? null;
  const activeCount = agents.filter((agent) => agent.active).length;
  const documentsCount = agents.reduce((sum, agent) => sum + agent.documents.length, 0);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8">
      <PageHeader
        eyebrow="Automação"
        title="Agentes"
        accent="de IA"
        description="Só o agente marcado com a estrela (em uso) responde os contatos da organização."
        actions={
          canEdit && (
            <Button onClick={() => navigate("/dashboard/agentes/novo")}>
              <Plus className="h-4 w-4" />
              Novo agente
            </Button>
          )
        }
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="flex min-h-72 flex-col items-center justify-center gap-4 border-dashed text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-float">
            <Bot className="h-6 w-6" />
          </span>
          <div>
            <p className="font-semibold">Nenhum agente ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {canEdit ? "Crie o primeiro para começar a atender no WhatsApp." : "Nenhum agente configurado."}
            </p>
          </div>
          {canEdit && (
            <Button onClick={() => navigate("/dashboard/agentes/novo")}>
              <Plus className="h-4 w-4" />
              Criar agente
            </Button>
          )}
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-4">
            {/* Agent in use */}
            <div className="relative overflow-hidden rounded-xl bg-zinc-950 p-6 text-white shadow-float lg:col-span-2">
              <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
              <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
              <div className="relative flex h-full flex-col justify-between gap-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/50">Em uso agora</p>
                    <p className="mt-3 truncate text-2xl font-semibold">
                      {inUse ? inUse.name : <span className="font-display font-normal italic text-white/70">Nenhum agente</span>}
                    </p>
                    <p className="mt-1 text-sm text-white/60">
                      {inUse
                        ? inUse.canAnswer
                          ? "Respondendo os contatos da organização."
                          : "Selecionado, mas só responde quando estiver ativo e com prompt."
                        : "Abra um agente e use-o nas conversas da organização."}
                    </p>
                  </div>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    <Sparkles className="h-5 w-5" />
                  </span>
                </div>
                {inUse && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="bg-white text-zinc-950 hover:bg-white/90"
                      onClick={() => navigate(`/dashboard/agentes/${inUse.id}`)}
                    >
                      Abrir agente
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                    {inUse.rgbs.enabled && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">RGBS</span>
                    )}
                    {inUse.scheduling.enabled && (
                      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                        Agenda reuniões
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            <StatTile
              label="Agentes ativos"
              value={`${activeCount}/${agents.length}`}
              detail="Ligados para atender"
              icon={Bot}
            />
            <StatTile
              label="Documentos"
              value={String(documentsCount)}
              detail="Na base de conhecimento (RAG)"
              icon={FileText}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => {
              const state = agentState(agent);
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => navigate(`/dashboard/agentes/${agent.id}`)}
                  className={cn(
                    "group flex flex-col rounded-xl border border-border/80 bg-card p-5 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-float focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/10",
                    agent.isOrganizationAgent && "border-foreground/30",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-display text-xl italic transition-colors",
                        agent.isOrganizationAgent
                          ? "bg-primary text-primary-foreground"
                          : "border bg-muted/50 text-foreground group-hover:bg-primary group-hover:text-primary-foreground",
                      )}
                    >
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 font-semibold">
                        <span className="truncate">{agent.name}</span>
                        {agent.isOrganizationAgent && (
                          <Star className="h-4 w-4 shrink-0 fill-foreground text-foreground" aria-label="Em uso" />
                        )}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn("h-1.5 w-1.5 rounded-full", state.dot)} />
                        {state.label}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>

                  <div className="mt-5 grid grid-cols-3 gap-2">
                    {[
                      { icon: ListChecks, value: String(agent.metadados.length), label: "metadados" },
                      { icon: FileText, value: String(agent.documents.length), label: "documentos" },
                      { icon: CalendarClock, value: agent.scheduling.enabled ? "Sim" : "Não", label: "agenda" },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border bg-muted/30 px-2.5 py-2">
                        <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <p className="mt-1.5 text-sm font-semibold tabular-nums">{item.value}</p>
                        <p className="text-[11px] text-muted-foreground">{item.label}</p>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
