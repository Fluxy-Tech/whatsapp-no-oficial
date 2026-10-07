import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, AgentsResponse, DocumentStatus } from "@/lib/agents";
import { usePermission } from "@/providers/OrganizationProvider";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AgentEditor } from "@/components/agents/AgentEditor";

type DocumentStatusEvent = DocumentStatus & { agentId: string; url: string };

/** /dashboard/agentes/{id} (or /novo): data of one agent. */
export function AgentDetailPage() {
  const { id = "" } = useParams();
  const isNew = id === "novo";
  const navigate = useNavigate();
  const socket = useSocket();
  const { canEdit } = usePermission("agentes");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isNew) {
      setAgent(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setAgent(await api<Agent>(`/api/agents/${encodeURIComponent(id)}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setAgent(null);
    } finally {
      setLoading(false);
    }
  }, [id, isNew]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live RAG ingestion progress of this agent's documents.
  useEffect(() => {
    function onDocumentStatus({ agentId, url, ...status }: DocumentStatusEvent) {
      setAgent((current) =>
        current && current.id === agentId
          ? { ...current, documentsStatus: { ...current.documentsStatus, [url]: status } }
          : current,
      );
    }
    socket.on("agent:document-status", onDocumentStatus);
    return () => {
      socket.off("agent:document-status", onDocumentStatus);
    };
  }, [socket]);

  function handleSaved(saved: Agent) {
    setAgent(saved);
    // A new agent gets its own URL once it exists.
    if (isNew) navigate(`/dashboard/agentes/${saved.id}`, { replace: true });
  }

  async function handleToggleOrganizationAgent(current: Agent) {
    try {
      const response = await api<AgentsResponse>("/api/agents/active", {
        method: "PUT",
        body: JSON.stringify({ agentId: current.isOrganizationAgent ? null : current.id }),
      });
      setAgent(response.agents.find((item) => item.id === current.id) ?? current);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="w-full space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard/agentes")}>
        <ArrowLeft className="h-4 w-4" />
        Voltar para agentes
      </Button>

      {error && agent && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : agent || isNew ? (
        <AgentEditor
          agent={agent}
          canEdit={canEdit}
          onSaved={handleSaved}
          onDeleted={() => navigate("/dashboard/agentes", { replace: true })}
          onToggleOrganizationAgent={handleToggleOrganizationAgent}
        />
      ) : (
        <Card className="flex min-h-60 items-center justify-center">
          <p className="text-sm text-muted-foreground">{error ?? "Agente não encontrado."}</p>
        </Card>
      )}
    </div>
  );
}
