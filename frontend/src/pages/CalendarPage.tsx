import { usePermission } from "@/providers/OrganizationProvider";
import { CalendarView } from "@/components/dashboard/CalendarView";

/** CRM › Calendário (/dashboard/calendario). */
export function CalendarPage() {
  const { canEdit } = usePermission("crm");
  return (
    <div className="h-full">
      <CalendarView canEdit={canEdit} />
    </div>
  );
}
