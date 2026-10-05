import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/relative-time";
import { useSocket } from "@/providers/SocketProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Target = {
  id: string;
  targetId: string;
  name: string | null;
  pushname: string | null;
  isGroup: boolean;
  firstMessageAt: string;
  lastMessageAt: string;
};

type TargetsListProps = {
  selectedChatId?: string | null;
  onSelect?: (chatId: string, label: string) => void;
};

export function TargetsList({ selectedChatId, onSelect }: TargetsListProps) {
  const socket = useSocket();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);

  function loadTargets() {
    api<Target[]>("/api/whatsapp/targets")
      .then(setTargets)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTargets();
  }, []);

  useEffect(() => {
    function refresh() {
      loadTargets();
    }

    // "target-added" covers new targets; "message" covers lastMessageAt
    // moving on existing ones (reordering who talked most recently).
    socket.on("whatsapp:target-added", refresh);
    socket.on("whatsapp:message", refresh);
    return () => {
      socket.off("whatsapp:target-added", refresh);
      socket.off("whatsapp:message", refresh);
    };
  }, [socket]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Targets</CardTitle>
        <CardDescription>
          {loading
            ? "Carregando..."
            : `${targets.length} contato(s) que já mandaram mensagem.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!loading && targets.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum target capturado ainda.</p>
        )}
        <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto">
          {targets.map((target) => {
            const displayName = target.name ?? target.pushname ?? target.targetId;
            const isSelected = selectedChatId === target.targetId;

            return (
              <li key={target.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(target.targetId, displayName)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-3 py-3 text-left transition-colors hover:bg-accent",
                    isSelected && "bg-accent",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {formatRelativeTime(target.lastMessageAt)}
                    </p>
                  </div>
                  {target.isGroup && <Badge variant="secondary">Grupo</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
