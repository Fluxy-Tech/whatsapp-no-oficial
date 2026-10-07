import { usePermission } from "@/providers/OrganizationProvider";
import { KanbanBoard } from "@/components/dashboard/KanbanBoard";

/** CRM › Quadro (/dashboard/quadro). */
export function BoardPage() {
  const { canEdit } = usePermission("crm");
  return (
    <div className="h-full">
      <KanbanBoard canEdit={canEdit} />
    </div>
  );
}
