import { useState } from "react";
import { History, Plus, Settings } from "lucide-react";
import { usePermission } from "@/providers/OrganizationProvider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { TabsNav, type TabItem } from "@/components/ui/tabs-nav";
import { CampaignHistoryTab } from "@/components/campaigns/CampaignHistoryTab";
import { CampaignNewTab } from "@/components/campaigns/CampaignNewTab";
import { CampaignSettingsTab } from "@/components/campaigns/CampaignSettingsTab";

type Tab = "history" | "new" | "settings";

/** /dashboard/campanhas: bulk sends through the connected WhatsApp. */
export function CampaignsPage() {
  const { canEdit } = usePermission("campanhas");
  const [tab, setTab] = useState<Tab>("history");

  const tabs: TabItem<Tab>[] = [
    { id: "history", label: "Histórico de campanhas", icon: History },
    ...(canEdit ? [{ id: "new" as const, label: "Nova campanha", icon: Plus }] : []),
    { id: "settings", label: "Configurações", icon: Settings },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        eyebrow="Automação"
        title="Campanhas"
        accent="em massa"
        description="Disparos em massa (ou manuais) pelo WhatsApp conectado, histórico de envios e configurações."
        actions={
          canEdit && tab !== "new" ? (
            <Button onClick={() => setTab("new")}>
              <Plus className="h-4 w-4" />
              Nova campanha
            </Button>
          ) : null
        }
      />

      <TabsNav tabs={tabs} value={tab} onChange={setTab} />

      {tab === "history" && <CampaignHistoryTab />}
      {tab === "new" && canEdit && <CampaignNewTab />}
      {tab === "settings" && <CampaignSettingsTab canEdit={canEdit} />}
    </div>
  );
}
