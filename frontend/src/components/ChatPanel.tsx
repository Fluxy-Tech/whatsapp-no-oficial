import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Bot, MessagesSquare, Pause, Play, SendHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone, initials } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ChatMessageMedia } from "@/components/ChatMessageMedia";

type Message = {
  id: string;
  wppId: string;
  body: string | null;
  caption: string | null;
  filename: string | null;
  type: string;
  fromMe: boolean;
  timestamp: string;
};

type ChatPanelProps = {
  chatId: string | null;
  contactLabel?: string | null;
  /** Mobile: back to the contact list. */
  onBack?: () => void;
};

const TIME = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

/** "Hoje", "Ontem" or "12 de outubro de 2026" between messages of different days. */
function dayLabel(date: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoje";
  if (date.toDateString() === yesterday.toDateString()) return "Ontem";
  return DAY.format(date);
}

export function ChatPanel({ chatId, contactLabel, onBack }: ChatPanelProps) {
  const socket = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // AI agent on/off for this contact; null = unknown (contact not saved yet).
  const [agentActive, setAgentActive] = useState<boolean | null>(null);
  const [togglingAgent, setTogglingAgent] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Each new message reloads the history; only the latest request may update
  // the screen, or a slower older response would bring back an outdated list.
  const requestRef = useRef(0);

  function loadMessages(id: string, { initial = false } = {}) {
    const request = ++requestRef.current;
    if (initial) setLoading(true);
    api<Message[]>(`/api/messages/chats/${encodeURIComponent(id)}/messages`)
      .then((items) => {
        if (request === requestRef.current) setMessages(items);
      })
      .finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
  }

  useEffect(() => {
    if (!chatId) {
      requestRef.current++;
      setMessages([]);
      return;
    }
    setMessages([]);
    loadMessages(chatId, { initial: true });
  }, [chatId]);

  useEffect(() => {
    function onMessage({ chatId: incomingChatId }: { chatId: string }) {
      if (chatId && incomingChatId === chatId) loadMessages(chatId);
    }

    socket.on("whatsapp:message", onMessage);
    return () => {
      socket.off("whatsapp:message", onMessage);
    };
  }, [socket, chatId]);

  useEffect(() => {
    setAgentActive(null);
    setAgentError(null);
    if (!chatId) return;
    let cancelled = false;
    api<{ agentActive: boolean }>(`/api/whatsapp/contacts/${encodeURIComponent(chatId)}`)
      .then((contact) => {
        if (!cancelled) setAgentActive(contact.agentActive);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // Paused/resumed here, in the lead screen or by another attendant.
  useEffect(() => {
    function onContactUpdated({ contact }: { contact: { chatId: string; agentActive: boolean } }) {
      if (chatId && contact.chatId === chatId) setAgentActive(contact.agentActive);
    }

    socket.on("whatsapp:contact-updated", onContactUpdated);
    return () => {
      socket.off("whatsapp:contact-updated", onContactUpdated);
    };
  }, [socket, chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleToggleAgent() {
    if (!chatId || agentActive === null) return;
    setTogglingAgent(true);
    setAgentError(null);
    try {
      const contact = await api<{ agentActive: boolean }>(`/api/whatsapp/contacts/${encodeURIComponent(chatId)}/agent`, {
        method: "PUT",
        body: JSON.stringify({ agentActive: !agentActive }),
      });
      setAgentActive(contact.agentActive);
    } catch (err) {
      setAgentError((err as Error).message);
    } finally {
      setTogglingAgent(false);
    }
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    if (!chatId || !text.trim()) return;

    setSending(true);
    try {
      await api(`/api/messages/chats/${encodeURIComponent(chatId)}/send`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setText("");
      loadMessages(chatId);
    } finally {
      setSending(false);
    }
  }

  if (!chatId) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-float">
          <MessagesSquare className="h-6 w-6" />
        </span>
        <p className="font-semibold">Suas conversas aparecem aqui</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Selecione um contato para ver o histórico e responder pelo WhatsApp da empresa.
        </p>
      </div>
    );
  }

  const label = contactLabel ?? chatId;
  let lastDay = "";

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        {onBack && (
          <Button variant="ghost" size="icon" className="-ml-1 h-9 w-9 md:hidden" onClick={onBack} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initials(label)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{label}</p>
          <p className="truncate text-xs text-muted-foreground">{formatPhone(chatId.split("@")[0]) || chatId}</p>
        </div>
        {agentActive !== null && (
          <Button
            variant={agentActive ? "outline" : "default"}
            size="sm"
            className="ml-auto shrink-0 gap-2"
            onClick={handleToggleAgent}
            disabled={togglingAgent}
            title={agentActive ? "O agente para de responder só este contato" : "O agente volta a responder este contato"}
          >
            {togglingAgent ? (
              <Spinner className="size-4" />
            ) : agentActive ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">{agentActive ? "Pausar agente" : "Retomar agente"}</span>
          </Button>
        )}
      </div>

      {(agentActive === false || agentError) && (
        <div
          className={cn(
            "flex shrink-0 items-center gap-2 border-b border-border/70 px-4 py-2 text-xs",
            agentError ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
          )}
        >
          <Bot className="h-4 w-4 shrink-0" />
          {agentError ?? "Agente pausado neste contato: as respostas são manuais até você retomar."}
        </div>
      )}

      <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto bg-muted/40 px-4 py-5 sm:px-8">
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="rounded-full border bg-background px-4 py-1.5 text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
          </div>
        )}
        {messages.map((message) => {
          const date = new Date(message.timestamp);
          const day = date.toDateString();
          const separator = day !== lastDay ? dayLabel(date) : null;
          lastDay = day;
          return (
            <div key={message.id} className="contents">
              {separator && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-soft">
                    {separator}
                  </span>
                </div>
              )}
              <div
                className={cn(
                  "w-fit min-w-0 max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-[0_1px_1px_oklch(0%_0_0/0.06)]",
                  message.fromMe
                    ? "ml-auto rounded-br-md bg-primary text-primary-foreground"
                    : "rounded-bl-md border border-border/70 bg-background",
                )}
              >
                {message.type !== "chat" && (
                  <ChatMessageMedia
                    chatId={chatId}
                    wppId={message.wppId}
                    type={message.type}
                    filename={message.filename}
                  />
                )}
                {(message.body ?? message.caption) && (
                  <p className={cn("min-w-0 whitespace-pre-wrap break-words", message.type !== "chat" && "mt-1")}>
                    {message.body ?? message.caption}
                  </p>
                )}
                <p
                  className={cn(
                    "mt-0.5 text-right text-[10px] tabular-nums",
                    message.fromMe ? "text-primary-foreground/60" : "text-muted-foreground",
                  )}
                  title={date.toLocaleString("pt-BR")}
                >
                  {TIME.format(date)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} className="flex shrink-0 items-center gap-2 border-t border-border/70 p-3">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Digite uma mensagem..."
          disabled={sending}
          className="h-11 rounded-full bg-muted/40 px-5"
        />
        <Button
          type="submit"
          size="icon"
          className="h-11 w-11 shrink-0 rounded-full"
          disabled={sending || !text.trim()}
          aria-label="Enviar"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
