import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSocket } from "@/providers/SocketProvider";

export type ConnectionTone = "good" | "warning" | "critical";

const LABELS: Record<string, { label: string; tone: ConnectionTone }> = {
  CONNECTED: { label: "Conectado", tone: "good" },
  STARTING: { label: "Iniciando", tone: "warning" },
  OPENING: { label: "Abrindo conexão", tone: "warning" },
  PAIRING: { label: "Pareando", tone: "warning" },
  QRCODE: { label: "Aguardando QR Code", tone: "warning" },
  DISCONNECTED: { label: "Desconectado", tone: "critical" },
  UNPAIRED: { label: "Desconectado do celular", tone: "critical" },
  UNPAIRED_IDLE: { label: "Desconectado do celular", tone: "critical" },
  TIMEOUT: { label: "Tempo esgotado", tone: "critical" },
  ERROR: { label: "Erro na conexão", tone: "critical" },
};

export function describeConnection(status: string | null) {
  if (!status) return { label: "Verificando", tone: "warning" as ConnectionTone };
  return LABELS[status] ?? { label: status, tone: "warning" as ConnectionTone };
}

/** Live WhatsApp status of the active organization (REST on mount, socket afterwards). */
export function useWhatsappStatus() {
  const socket = useSocket();
  const [status, setStatus] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () =>
      api<{ status: string; phoneNumber: string | null }>("/api/whatsapp/status")
        .then((data) => {
          setStatus(data.status);
          setPhoneNumber(data.phoneNumber);
        })
        .catch(() => {});
    function onStatus(data: { status: string; phoneNumber?: string | null }) {
      setStatus(data.status);
      if (data.phoneNumber) setPhoneNumber(data.phoneNumber);
    }
    refresh();
    socket.on("whatsapp:status", onStatus);
    socket.io.on("reconnect", refresh);
    return () => {
      socket.off("whatsapp:status", onStatus);
      socket.io.off("reconnect", refresh);
    };
  }, [socket]);

  return { status, phoneNumber, ...describeConnection(status) };
}
