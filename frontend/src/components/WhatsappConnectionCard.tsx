import { useEffect, useState } from "react";
import { MessageSquareDot, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";

type WhatsappStatus = {
  status: string;
  qrCode: string | null;
  phoneNumber: string | null;
};

type UnreadSweep = {
  chats: number;
  queued: number;
  alreadySaved: number;
  waitingDecryption: number;
};

function sweepSummary({ chats, queued, alreadySaved, waitingDecryption }: UnreadSweep) {
  if (chats === 0) return "Nenhuma conversa com mensagens não lidas.";
  const parts = [
    `${chats} conversa(s) com mensagens não lidas`,
    `${queued} mensagem(ns) nova(s) enviada(s) para o agente`,
  ];
  if (alreadySaved) parts.push(`${alreadySaved} já estava(m) na plataforma`);
  if (waitingDecryption) parts.push(`${waitingDecryption} ainda criptografada(s), entram quando o WhatsApp liberar`);
  return parts.join(" · ");
}

const STATUS_LABELS: Record<string, string> = {
  DISCONNECTED: "Desconectado",
  STARTING: "Iniciando...",
  QRCODE: "Aguardando leitura do QR Code",
  CONNECTED: "Conectado",
  ERROR: "Erro",
  OPENING: "Abrindo conexão...",
  PAIRING: "Pareando...",
  TIMEOUT: "Tempo esgotado",
  UNPAIRED: "Desconectado do celular",
  UNPAIRED_IDLE: "Desconectado do celular",
};

const STARTING_STATUSES = new Set(["STARTING", "OPENING", "PAIRING"]);

export function WhatsappConnectionCard({ canConnect }: { canConnect: boolean }) {
  const socket = useSocket();
  const [state, setState] = useState<WhatsappStatus>({ status: "DISCONNECTED", qrCode: null, phoneNumber: null });
  const [loading, setLoading] = useState<"connect" | "disconnect" | "logout" | "sweep" | null>(null);
  const [sweepResult, setSweepResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const refresh = () => api<WhatsappStatus>("/api/whatsapp/status").then(setState).catch(() => {});
    refresh();
    // Events emitted while the socket was down are lost: resync on reconnect.
    socket.io.on("reconnect", refresh);
    return () => {
      socket.io.off("reconnect", refresh);
    };
  }, [socket]);

  useEffect(() => {
    function onQr({ qrCode }: { qrCode: string }) {
      setState((prev) => ({ ...prev, status: "QRCODE", qrCode }));
    }
    function onStatus({ status, phoneNumber }: { status: string; phoneNumber?: string | null }) {
      setState((prev) => ({
        ...prev,
        status,
        qrCode: status === "CONNECTED" ? null : prev.qrCode,
        phoneNumber: phoneNumber ?? prev.phoneNumber,
      }));
    }

    socket.on("whatsapp:qr", onQr);
    socket.on("whatsapp:status", onStatus);

    return () => {
      socket.off("whatsapp:qr", onQr);
      socket.off("whatsapp:status", onStatus);
    };
  }, [socket]);

  async function handleConnect() {
    setLoading("connect");
    try {
      await api("/api/whatsapp/connect", { method: "POST" });
    } finally {
      setLoading(null);
    }
  }

  async function handleDisconnect() {
    setLoading("disconnect");
    try {
      await api("/api/whatsapp/disconnect", { method: "POST" });
      setState((prev) => ({ ...prev, status: "DISCONNECTED", qrCode: null }));
    } finally {
      setLoading(null);
    }
  }

  // Logo depois de conectar, o WhatsApp Web pode não avisar mensagens de
  // conversas que ainda não foram abertas: a varredura busca as não lidas e
  // manda as que faltam para a plataforma e o agente.
  async function handleSweep() {
    setLoading("sweep");
    setSweepResult(null);
    try {
      const result = await api<UnreadSweep>("/api/whatsapp/sweep-unread", { method: "POST" });
      setSweepResult({ ok: true, text: sweepSummary(result) });
    } catch (error) {
      setSweepResult({ ok: false, text: (error as Error).message });
    } finally {
      setLoading(null);
    }
  }

  // Desvincula o número do WhatsApp e apaga a sessão salva: o próximo
  // "Conectar" gera um QR Code novo (pode ser outro número).
  async function handleLogout() {
    const confirmed = await confirmAction({
      title: "Deslogar este número do WhatsApp?",
      description: "Para conectar de novo será preciso escanear um novo QR Code.",
      confirmLabel: "Deslogar",
      destructive: true,
    });
    if (!confirmed) return;

    setLoading("logout");
    try {
      await api("/api/whatsapp/logout", { method: "POST" });
      setState({ status: "DISCONNECTED", qrCode: null, phoneNumber: null });
    } finally {
      setLoading(null);
    }
  }

  const isConnected = state.status === "CONNECTED";
  // Do clique em "Conectar" até o QR Code (ou a conexão) chegar pelo socket.
  const isStarting = loading === "connect" || STARTING_STATUSES.has(state.status);
  const isConnecting = isStarting || state.status === "QRCODE";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Smartphone className="h-5 w-5" />
            </span>
            <CardTitle>Conexão com WhatsApp</CardTitle>
          </div>
          {/* Enquanto inicia, o spinner do card já mostra o "Iniciando...". */}
          {!isStarting && (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium",
                isConnected ? "border-emerald-200/80 bg-emerald-50 text-emerald-700" : "bg-muted/50 text-muted-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", isConnected ? "bg-emerald-500" : "bg-muted-foreground/50")} />
              {STATUS_LABELS[state.status] ?? state.status}
            </span>
          )}
        </div>
        <CardDescription>
          {isConnected
            ? `Número conectado: ${state.phoneNumber ?? "desconhecido"}`
            : "Conecte o WhatsApp da organização para começar a coletar e enviar mensagens."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isStarting && (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <Spinner className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Iniciando...</p>
          </div>
        )}

        {state.status === "QRCODE" && state.qrCode && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-muted/30 py-6">
            <img src={state.qrCode} alt="QR Code do WhatsApp" className="h-56 w-56 rounded-xl border bg-white p-2 shadow-soft" />
            <p className="text-sm text-muted-foreground">
              Abra o WhatsApp no celular e escaneie o código acima.
            </p>
          </div>
        )}

        {!canConnect && (
          <p className="text-sm text-muted-foreground">
            Apenas administradores da organização podem conectar ou desconectar o WhatsApp.
          </p>
        )}

        {canConnect && (
          <div className="flex flex-wrap gap-2">
            {!isConnected ? (
              !isConnecting && (
                <Button onClick={handleConnect} disabled={loading !== null}>
                  Conectar WhatsApp
                </Button>
              )
            ) : (
              <>
                <Button onClick={handleSweep} disabled={loading !== null}>
                  {loading === "sweep" ? <Spinner className="size-4" /> : <MessageSquareDot className="h-4 w-4" />}
                  {loading === "sweep" ? "Varrendo conversas..." : "Varrer conversas não lidas"}
                </Button>
                <Button variant="outline" onClick={handleDisconnect} disabled={loading !== null}>
                  {loading === "disconnect" ? "Desconectando..." : "Desconectar"}
                </Button>
                <Button variant="destructive" onClick={handleLogout} disabled={loading !== null}>
                  {loading === "logout" ? "Deslogando..." : "Deslogar da conta"}
                </Button>
              </>
            )}
          </div>
        )}

        {canConnect && isConnected && (
          <p className={cn("text-sm", sweepResult && !sweepResult.ok ? "text-destructive" : "text-muted-foreground")}>
            {sweepResult?.text ??
              "Depois de conectar, use a varredura para trazer as mensagens que os clientes mandaram e ainda não apareceram na plataforma. Elas vão para o agente responder."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
