import { env } from "../../config/env";
import { claimDueCampaigns, processCampaignBatch } from "../../application/use-cases/process-scheduled-campaigns";

/// "Cron" do disparo escalonado: a cada CAMPAIGN_SCHEDULER_INTERVAL_MS reserva
/// as campanhas com lote vencido e envia um lote de cada. Usa setTimeout
/// encadeado (não setInterval) pra um tick nunca sobrepor o anterior, e não
/// espera os lotes terminarem pra agendar o próximo tick — uma campanha com
/// lote grande não segura as demais. CAMPAIGN_SCHEDULER_MAX_CONCURRENT limita
/// quantos lotes rodam ao mesmo tempo nesta instância.
export function startCampaignScheduler(): void {
  const inFlight = new Set<string>();

  async function tick() {
    const free = env.CAMPAIGN_SCHEDULER_MAX_CONCURRENT - inFlight.size;
    if (free <= 0) return;

    const ids = await claimDueCampaigns(free);
    for (const id of ids) {
      // Só acontece se um lote demorar mais que o lease — o lote em
      // andamento já reagenda a campanha ao terminar.
      if (inFlight.has(id)) continue;

      inFlight.add(id);
      processCampaignBatch(id)
        .catch((error) => console.error(`[CAMPAIGN-SCHEDULER] falha no lote da campaignId=${id}:`, error))
        .finally(() => inFlight.delete(id));
    }
  }

  function loop() {
    tick()
      .catch((error) => console.error("[CAMPAIGN-SCHEDULER] falha ao buscar campanhas agendadas:", error))
      .finally(() => setTimeout(loop, env.CAMPAIGN_SCHEDULER_INTERVAL_MS));
  }

  console.log(`[CAMPAIGN-SCHEDULER] iniciado (intervalo ${env.CAMPAIGN_SCHEDULER_INTERVAL_MS}ms)`);
  loop();
}
