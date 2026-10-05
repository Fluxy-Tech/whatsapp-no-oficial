import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSocket } from "@/providers/SocketProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

export function WhatsappConnectionCard({ canConnect }: { canConnect: boolean }) {
  const socket = useSocket();
  const [state, setState] = useState<WhatsappStatus>({ status: "DISCONNECTED", qrCode: null, phoneNumber: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<WhatsappStatus>("/api/whatsapp/status").then(setState).catch(() => {});
  }, []);

  useEffect(() => {
    function onQr({ qrCode }: { qrCode: string }) {
      setState((prev) => ({ ...prev, status: "QRCODE", qrCode }));
    }
    function onStatus({ status }: { status: string }) {
      setState((prev) => ({ ...prev, status, qrCode: status === "CONNECTED" ? null : prev.qrCode }));
    }

    socket.on("whatsapp:qr", onQr);
    socket.on("whatsapp:status", onStatus);

    return () => {
      socket.off("whatsapp:qr", onQr);
      socket.off("whatsapp:status", onStatus);
    };
  }, [socket]);

  async function handleConnect() {
    setLoading(true);
    try {
      await api("/api/whatsapp/connect", { method: "POST" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    try {
      await api("/api/whatsapp/disconnect", { method: "POST" });
      setState({ status: "DISCONNECTED", qrCode: null, phoneNumber: null });
    } finally {
      setLoading(false);
    }
  }

  const isConnected = state.status === "CONNECTED";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Conexão com WhatsApp</CardTitle>
          <Badge variant={isConnected ? "default" : "secondary"}>
            {STATUS_LABELS[state.status] ?? state.status}
          </Badge>
        </div>
        <CardDescription>
          {isConnected
            ? `Número conectado: ${state.phoneNumber ?? "desconhecido"}`
            : "Conecte o WhatsApp da organização para começar a coletar e enviar mensagens."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
              <Button onClick={handleConnect} disabled={loading || state.status === "STARTING"}>
                {loading ? "Conectando..." : "Conectar WhatsApp"}
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleDisconnect} disabled={loading}>
                {loading ? "Desconectando..." : "Desconectar"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
