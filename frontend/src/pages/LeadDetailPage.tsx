import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/dashboard";
import type { AgentsResponse } from "@/lib/agents";
import { targetLabel, type Target } from "@/lib/leads";
import { usePermission } from "@/providers/OrganizationProvider";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { TargetDetail } from "@/components/TargetDetail";

/** /dashboard/lead/:id — data of one lead. */
export function LeadDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const socket = useSocket();
  const { canEdit } = usePermission("leads");
  const [target, setTarget] = useState<Target | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metadadoNames, setMetadadoNames] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setTarget(await api<Target>(`/api/whatsapp/targets/${encodeURIComponent(id)}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Metadados of the agent in use: shown as fields to fill on the lead.
  useEffect(() => {
    api<AgentsResponse>("/api/agents")
      .then(({ agents }) => {
        const inUse = agents.find((agent) => agent.isOrganizationAgent);
        setMetadadoNames(inUse?.metadados.map((m) => m.name) ?? []);
      })
      .catch(() => setMetadadoNames([]));
  }, []);

  // The agent may collect data while the page is open.
  useEffect(() => {
    function onContactUpdated({ contact }: { contact: Target }) {
      if (contact.id === id) setTarget((current) => (current ? { ...current, ...contact } : contact));
    }
    socket.on("whatsapp:contact-updated", onContactUpdated);
    return () => {
      socket.off("whatsapp:contact-updated", onContactUpdated);
    };
  }, [socket, id]);

  function openChat(lead: Target) {
    navigate("/dashboard/conversas", { state: { initialChatId: lead.targetId, initialLabel: targetLabel(lead) } });
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        leading={
          <Button
            variant="outline"
            size="icon"
            className="mt-1 shrink-0"
            aria-label="Voltar para leads"
            onClick={() => navigate("/dashboard/leads")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        }
        eyebrow="Lead"
        title={target ? targetLabel(target) : "Ficha do lead"}
        description={target ? formatPhone(target.number) || target.targetId : undefined}
        actions={
          target && (
            <Button onClick={() => openChat(target)}>
              <MessageSquare className="h-4 w-4" />
              Abrir conversa
            </Button>
          )
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      ) : target ? (
        <TargetDetail
          target={target}
          metadadoNames={metadadoNames}
          canEdit={canEdit}
          onUpdated={(patch) => setTarget((current) => (current ? { ...current, ...patch } : current))}
        />
      ) : (
        <Card className="flex min-h-60 items-center justify-center">
          <p className="text-sm text-muted-foreground">{error ?? "Lead não encontrado."}</p>
        </Card>
      )}
    </div>
  );
}
