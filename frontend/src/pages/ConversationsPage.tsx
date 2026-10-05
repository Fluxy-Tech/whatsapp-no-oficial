import { useState } from "react";
import { useLocation } from "react-router-dom";
import { ContactsList } from "@/components/ContactsList";
import { ChatPanel } from "@/components/ChatPanel";

type NavState = { initialChatId?: string; initialLabel?: string } | null;

export function ConversationsPage() {
  const location = useLocation();
  const navState = location.state as NavState;

  const [selectedChatId, setSelectedChatId] = useState<string | null>(navState?.initialChatId ?? null);
  const [selectedChatLabel, setSelectedChatLabel] = useState<string | null>(navState?.initialLabel ?? null);

  function handleSelectChat(chatId: string, label: string) {
    setSelectedChatId(chatId);
    setSelectedChatLabel(label);
  }

  return (
    <div className="flex h-full gap-6">
      <div className="w-80 shrink-0">
        <ContactsList selectedChatId={selectedChatId} onSelect={handleSelectChat} />
      </div>
      <div className="min-w-0 flex-1">
        <ChatPanel chatId={selectedChatId} contactLabel={selectedChatLabel} />
      </div>
    </div>
  );
}
