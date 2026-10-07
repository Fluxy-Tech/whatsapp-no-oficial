import { useRef, useState } from "react";
import { FileText, Link2, RefreshCw, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { documentName, type Agent, type DocumentStatus } from "@/lib/agents";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

const STATUS_LABELS: Record<DocumentStatus["status"], string> = {
  pending: "Na fila",
  processing: "Processando",
  ready: "Pronto",
  failed: "Falhou",
};

function StatusBadge({ status }: { status: DocumentStatus | null }) {
  if (!status) return <Badge variant="secondary">Sem status</Badge>;
  const label = STATUS_LABELS[status.status] ?? status.status;
  if (status.status === "ready") return <Badge>{`${label} · ${status.chunks ?? 0} trechos`}</Badge>;
  if (status.status === "failed") return <Badge variant="destructive">{label}</Badge>;
  return (
    <Badge variant="secondary" className="gap-1">
      <Spinner className="size-3" />
      {label}
    </Badge>
  );
}

type AgentDocumentsProps = {
  agent: Agent;
  canEdit: boolean;
  onAgentChange: (agent: Agent) => void;
};

export function AgentDocuments({ agent, canEdit, onAgentChange }: AgentDocumentsProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<Agent>) {
    setBusy(true);
    setError(null);
    try {
      onAgentChange(await action());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleUpload(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    run(() => api<Agent>(`/api/agents/${agent.id}/documents`, { method: "POST", body: form })).finally(() => {
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  function handleAddLink(event: React.FormEvent) {
    event.preventDefault();
    if (!link.trim()) return;
    run(() =>
      api<Agent>(`/api/agents/${agent.id}/documents/link`, { method: "POST", body: JSON.stringify({ url: link.trim() }) }),
    ).then(() => setLink(""));
  }

  return (
    <div className="space-y-3">
      {agent.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum documento. Envie arquivos (PDF, DOCX, TXT, MD, CSV) ou links com informações da empresa para o agente
          consultar.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {agent.documents.map((url) => {
            const status = agent.documentsStatus[url] ?? null;
            return (
              <li key={url} className="flex items-center gap-3 px-3 py-2">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={url}>
                    {documentName(url)}
                  </p>
                  {status?.status === "failed" && status.error && (
                    <p className="truncate text-xs text-destructive" title={status.error}>
                      {status.error}
                    </p>
                  )}
                </div>
                <StatusBadge status={status} />
                {canEdit && (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Processar de novo"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          api<Agent>(`/api/agents/${agent.id}/documents/reingest`, {
                            method: "POST",
                            body: JSON.stringify({ url }),
                          }),
                        )
                      }
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remover documento"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`Remover "${documentName(url)}" da base de conhecimento?`)) return;
                        run(() =>
                          api<Agent>(`/api/agents/${agent.id}/documents?url=${encodeURIComponent(url)}`, {
                            method: "DELETE",
                          }),
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files?.[0])}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? <Spinner className="size-4" /> : <Upload className="h-4 w-4" />}
            Enviar arquivo
          </Button>
          <form onSubmit={handleAddLink} className="flex flex-1 gap-2">
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://site-da-empresa.com/catalogo.pdf"
              disabled={busy}
            />
            <Button type="submit" variant="outline" disabled={busy || !link.trim()}>
              <Link2 className="h-4 w-4" />
              Adicionar link
            </Button>
          </form>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
