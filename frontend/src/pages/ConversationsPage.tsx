import { useState } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
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

  // One panel, like WhatsApp Web: contacts on the left, chat on the right.
  // On small screens only one side shows at a time.
  return (
    <div className="flex h-full min-h-[32rem] overflow-hidden rounded-2xl border border-border/80 bg-background shadow-soft">
      <div className={cn("w-full shrink-0 border-r border-border/70 md:flex md:w-80", selectedChatId ? "hidden" : "flex")}>
        <ContactsList selectedChatId={selectedChatId} onSelect={handleSelectChat} />
      </div>
      <div className={cn("min-w-0 flex-1 md:flex", selectedChatId ? "flex" : "hidden")}>
        <ChatPanel
          chatId={selectedChatId}
          contactLabel={selectedChatLabel}
          onBack={() => setSelectedChatId(null)}
        />
      </div>
    </div>
  );
}
