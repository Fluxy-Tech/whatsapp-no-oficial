import { useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
};

export function ChatPanel({ chatId, contactLabel }: ChatPanelProps) {
  const socket = useSocket();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  function loadMessages(id: string) {
    setLoading(true);
    api<Message[]>(`/api/messages/chats/${encodeURIComponent(id)}/messages`)
      .then(setMessages)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    loadMessages(chatId);
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
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
      <Card className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Selecione um contato para ver a conversa.</p>
      </Card>
    );
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="border-b">
        <CardTitle className="truncate">{contactLabel ?? chatId}</CardTitle>
        <CardDescription className="truncate">{chatId?.split("@")[0]}</CardDescription>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto pt-4">
        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex w-fit min-w-0 max-w-[75%] flex-col gap-1",
              message.fromMe && "ml-auto items-end",
            )}
          >
            <div
              className={cn(
                "min-w-0 rounded-lg px-2.5 py-1.5 text-sm",
                message.fromMe ? "bg-primary text-primary-foreground" : "bg-muted",
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
                <p
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words",
                    message.type !== "chat" && "mt-1",
                  )}
                >
                  {message.body ?? message.caption}
                </p>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">
              {new Date(message.timestamp).toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </CardContent>

      <CardFooter className="border-t pt-4">
        <form onSubmit={handleSend} className="flex w-full gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Digite uma mensagem..."
            disabled={sending}
          />
          <Button type="submit" disabled={sending || !text.trim()}>
            <SendHorizontal className="h-4 w-4" />
            Enviar
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
