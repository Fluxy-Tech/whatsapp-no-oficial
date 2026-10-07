import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, CalendarClock, ChevronRight, FileText, ListChecks, Plus, Star } from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, AgentsResponse } from "@/lib/agents";
import { usePermission } from "@/providers/OrganizationProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

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

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Agentes de IA</h1>
          <p className="text-sm text-muted-foreground">
            Só o agente marcado com a estrela (em uso) responde os contatos da organização.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => navigate("/dashboard/agentes/novo")}>
            <Plus className="h-4 w-4" />
            Novo agente
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="flex min-h-60 flex-col items-center justify-center gap-2 text-center">
          <Bot className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {canEdit ? "Nenhum agente ainda. Crie o primeiro para começar." : "Nenhum agente configurado."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => navigate(`/dashboard/agentes/${agent.id}`)}
              className="rounded-lg border bg-background p-5 text-left shadow-xs transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-semibold">
                    {agent.isOrganizationAgent && (
                      <Star className="h-4 w-4 shrink-0 fill-foreground text-foreground" aria-label="Em uso" />
                    )}
                    <span className="truncate">{agent.name}</span>
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!agent.active && <Badge variant="secondary">Inativo</Badge>}
                    {agent.active && !agent.context.trim() && <Badge variant="outline">Sem prompt</Badge>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ListChecks className="h-3.5 w-3.5" />
                  {agent.metadados.length} metadado(s)
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  {agent.documents.length} documento(s)
                </span>
                <span className="flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {agent.scheduling.enabled ? "Agenda reuniões" : "Sem agendamento"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
