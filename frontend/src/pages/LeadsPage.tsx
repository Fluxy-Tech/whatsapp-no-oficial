import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, ChevronRight, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/dashboard";
import { targetLabel, type Target } from "@/lib/leads";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** /dashboard/leads: every lead with the date of the last conversation. */
export function LeadsPage() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      setTargets(await api<Target[]>("/api/whatsapp/targets"));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New leads, new messages (last conversation) and edits show up live.
  useEffect(() => {
    const refresh = () => void load();
    socket.on("whatsapp:message", refresh);
    socket.on("whatsapp:contact-updated", refresh);
    return () => {
      socket.off("whatsapp:message", refresh);
      socket.off("whatsapp:contact-updated", refresh);
    };
  }, [socket, load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D/g, "");
    if (!term) return targets;
    return targets.filter(
      (target) =>
        targetLabel(target).toLowerCase().includes(term) || (digits.length > 0 && (target.number ?? "").includes(digits)),
    );
  }, [targets, search]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            {loading ? "Carregando..." : `${targets.length} lead(s) que já conversaram com a empresa.`}
          </CardDescription>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            className="h-9 w-64 pl-9"
            aria-label="Buscar lead"
          />
        </div>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search ? "Nenhum lead encontrado." : "Nenhum lead capturado ainda."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Telefone</th>
                  <th className="px-4 py-2 font-medium">Agente de IA</th>
                  <th className="px-4 py-2 font-medium">Dados coletados</th>
                  <th className="px-4 py-2 font-medium">Última conversa</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((target) => {
                  const collected = Object.values(target.extras).filter((value) => String(value).trim()).length;
                  return (
                    <tr
                      key={target.id}
                      onClick={() => navigate(`/dashboard/lead/${target.id}`)}
                      className="cursor-pointer transition-colors hover:bg-accent/50"
                    >
                      <td className="px-4 py-3 font-medium">
                        <a
                          href={`/dashboard/lead/${target.id}`}
                          onClick={(event) => {
                            event.preventDefault();
                            navigate(`/dashboard/lead/${target.id}`);
                          }}
                          className="hover:underline"
                        >
                          {targetLabel(target)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{formatPhone(target.number) || "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-xs font-medium",
                            target.agentActive ? "text-primary" : "text-muted-foreground",
                          )}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          {target.agentActive ? "Ligado" : "Desligado"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{collected}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {target.lastMessageAt ? DATE_TIME.format(new Date(target.lastMessageAt)) : "—"}
                      </td>
                      <td className="px-2 py-3 text-muted-foreground">
                        <ChevronRight className="h-4 w-4" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
