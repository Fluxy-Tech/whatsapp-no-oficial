import { AlertTriangle, Headset, X } from "lucide-react";
import type { HumanHandoff } from "@/lib/handoffs";
import { Spinner } from "@/components/ui/spinner";

const DATE_TIME = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

type HandoffReportPanelProps = {
  /** Most recent first. */
  handoffs: HumanHandoff[];
  onClose: () => void;
};

/** Right side of the conversation: OpenAI's report (summary + key points) of each handoff. */
export function HandoffReportPanel({ handoffs, onClose }: HandoffReportPanelProps) {
  return (
    <aside className="absolute inset-0 z-10 flex flex-col bg-background lg:static lg:w-80 lg:shrink-0 lg:border-l lg:border-border/70 xl:w-96">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border/70 px-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600">
          <Headset className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">Relatório do atendimento</p>
          <p className="truncate text-xs text-muted-foreground">Gerado pela OpenAI com o histórico da conversa</p>
        </div>
        <button
          type="button"
          aria-label="Fechar relatório"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {handoffs.map((handoff, index) => (
          <section key={handoff.id} className="space-y-3 rounded-xl border border-border/70 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">{index === 0 ? "Pedido mais recente" : "Pedido anterior"}</h3>
              <span className="text-xs tabular-nums text-muted-foreground">
                {DATE_TIME.format(new Date(handoff.createdAt))}
              </span>
            </div>

            {handoff.reason && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Motivo: </span>
                {handoff.reason}
              </p>
            )}

            {handoff.summaryStatus === "pending" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Gerando o relatório da conversa...
              </p>
            )}

            {handoff.summaryStatus === "failed" && (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {handoff.summaryError ?? "Não foi possível gerar o relatório."}
              </p>
            )}

            {handoff.summaryStatus === "ready" && (
              <>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resumo</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{handoff.summary}</p>
                </div>
                {handoff.keyPoints.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pontos-chave</p>
                    <ul className="list-disc space-y-1 pl-4 text-sm">
                      {handoff.keyPoints.map((point, pointIndex) => (
                        <li key={pointIndex}>{point}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        ))}
      </div>
    </aside>
  );
}
