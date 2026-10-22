import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headset, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/dashboard";
import { playSound, type HumanHandoff, type SocketContact } from "@/lib/handoffs";
import { usePermission } from "@/providers/OrganizationProvider";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";

type Alert = { handoff: HumanHandoff; label: string };

type HandoffContextValue = {
  /** Conversations waiting for an attendant (nobody opened them yet). */
  pendingChatIds: Set<string>;
  /** The attendant opened the conversation: clears its alert for everyone. */
  acknowledge: (chatId: string) => void;
};

const HandoffContext = createContext<HandoffContextValue>({ pendingChatIds: new Set(), acknowledge: () => {} });

export function useHandoffs() {
  return useContext(HandoffContext);
}

const contactLabel = (contact: SocketContact) =>
  contact.name || formatPhone(contact.number ?? "") || contact.chatId.split("@")[0];

/**
 * Attendant alerts, on every screen: the "client asked for a person" sound,
 * badge and pop-up, and the new message sound for contacts the agent isn't
 * answering.
 */
export function HandoffProvider({ children }: { children: React.ReactNode }) {
  const socket = useSocket();
  const navigate = useNavigate();
  const { canView } = usePermission("conversas");
  const [pendingChatIds, setPendingChatIds] = useState<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const clear = useCallback((chatId: string) => {
    setPendingChatIds((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Set(prev);
      next.delete(chatId);
      return next;
    });
    setAlerts((prev) => prev.filter((alert) => alert.handoff.chatId !== chatId));
  }, []);

  useEffect(() => {
    if (!canView) return;
    api<HumanHandoff[]>("/api/whatsapp/handoffs/pending")
      .then((handoffs) => setPendingChatIds(new Set(handoffs.map((handoff) => handoff.chatId))))
      .catch(() => {});
  }, [canView]);

  useEffect(() => {
    if (!canView) return;

    function onRequested({ handoff, contact }: { handoff: HumanHandoff; contact: SocketContact }) {
      playSound("clienteSolicitouAtendimento.mp3");
      setPendingChatIds((prev) => new Set(prev).add(handoff.chatId));
      setAlerts((prev) => [
        { handoff, label: contactLabel(contact) },
        ...prev.filter((alert) => alert.handoff.chatId !== handoff.chatId),
      ]);
    }

    function onAcknowledged({ chatId }: { chatId: string }) {
      clear(chatId);
    }

    function onMessage({ message, agentAnswering }: { message: { fromMe: boolean }; agentAnswering?: boolean }) {
      if (!message.fromMe && agentAnswering === false) playSound("novaMensagem.mp3");
    }

    socket.on("handoff:requested", onRequested);
    socket.on("handoff:acknowledged", onAcknowledged);
    socket.on("whatsapp:message", onMessage);
    return () => {
      socket.off("handoff:requested", onRequested);
      socket.off("handoff:acknowledged", onAcknowledged);
      socket.off("whatsapp:message", onMessage);
    };
  }, [socket, canView, clear]);

  const acknowledge = useCallback(
    (chatId: string) => {
      clear(chatId);
      api(`/api/whatsapp/contacts/${encodeURIComponent(chatId)}/handoffs/acknowledge`, { method: "POST" }).catch(() => {});
    },
    [clear],
  );

  const value = useMemo(() => ({ pendingChatIds, acknowledge }), [pendingChatIds, acknowledge]);

  function openChat(alert: Alert) {
    setAlerts((prev) => prev.filter((item) => item !== alert));
    navigate("/dashboard/conversas", { state: { initialChatId: alert.handoff.chatId, initialLabel: alert.label } });
  }

  return (
    <HandoffContext.Provider value={value}>
      {children}
      {alerts.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
          {alerts.slice(0, 3).map((alert) => (
            <div
              key={alert.handoff.id}
              role="alert"
              className="pointer-events-auto flex items-start gap-3 rounded-2xl border border-red-500/30 bg-background p-4 shadow-float"
            >
              <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
                <Headset className="relative h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <div>
                  <p className="truncate text-sm font-semibold">{alert.label} pediu atendimento humano</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {alert.handoff.reason || "O agente foi desativado para este contato."}
                  </p>
                </div>
                <Button size="sm" onClick={() => openChat(alert)}>
                  Abrir conversa
                </Button>
              </div>
              <button
                type="button"
                aria-label="Fechar aviso"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                onClick={() => setAlerts((prev) => prev.filter((item) => item !== alert))}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </HandoffContext.Provider>
  );
}
