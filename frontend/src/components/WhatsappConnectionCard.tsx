import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type WhatsappStatus = {
  status: string;
  qrCode: string | null;
  phoneNumber: string | null;
};

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
  const [loading, setLoading] = useState<"connect" | "disconnect" | "logout" | null>(null);

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

  // Desvincula o número do WhatsApp e apaga a sessão salva: o próximo
  // "Conectar" gera um QR Code novo (pode ser outro número).
  async function handleLogout() {
    const confirmed = window.confirm(
      "Deslogar este número do WhatsApp? Para conectar de novo será preciso escanear um novo QR Code.",
    );
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
        <div className="flex items-center justify-between">
          <CardTitle>Conexão com WhatsApp</CardTitle>
          {/* Enquanto inicia, o spinner do card já mostra o "Iniciando...". */}
          {!isStarting && (
            <Badge variant={isConnected ? "default" : "secondary"}>
              {STATUS_LABELS[state.status] ?? state.status}
            </Badge>
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
          <div className="flex flex-col items-center gap-2">
            <img src={state.qrCode} alt="QR Code do WhatsApp" className="h-56 w-56 rounded-md border" />
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
          <div className="flex gap-2">
            {!isConnected ? (
              !isConnecting && (
                <Button onClick={handleConnect} disabled={loading !== null}>
                  Conectar WhatsApp
                </Button>
              )
            ) : (
              <>
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
      </CardContent>
    </Card>
  );
}
