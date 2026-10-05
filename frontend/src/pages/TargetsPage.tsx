import { useNavigate } from "react-router-dom";
import { TargetsList } from "@/components/TargetsList";

export function TargetsPage() {
  const navigate = useNavigate();

  function handleSelect(chatId: string, label: string) {
    navigate("/dashboard/conversas", { state: { initialChatId: chatId, initialLabel: label } });
  }

  return <TargetsList onSelect={handleSelect} />;
}
