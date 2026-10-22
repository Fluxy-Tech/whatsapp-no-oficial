import { useEffect, useMemo, useState } from "react";
import { Headset, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatPhone, initials } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { useHandoffs } from "@/providers/HandoffProvider";
import { useSocket } from "@/providers/SocketProvider";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";

type Contact = {
  id: string;
  contactId: string;
  name: string | null;
  pushname: string | null;
  formattedName: string | null;
  isMyContact: boolean;
  isBusiness: boolean;
  isGroup: boolean;
};

type ContactsListProps = {
  selectedChatId?: string | null;
  onSelect?: (chatId: string, label: string) => void;
};

export function ContactsList({ selectedChatId, onSelect }: ContactsListProps) {
  const socket = useSocket();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [unreadChatIds, setUnreadChatIds] = useState<Set<string>>(new Set());
  const { pendingChatIds } = useHandoffs();

  function loadContacts() {
    api<Contact[]>("/api/whatsapp/contacts")
      .then(setContacts)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadContacts();
  }, []);

  useEffect(() => {
    function onContactsSynced() {
      loadContacts();
    }

    function onMessage({ chatId }: { chatId: string }) {
      loadContacts(); // keeps the "most recent first" order up to date too

      if (chatId !== selectedChatId) {
        setUnreadChatIds((prev) => new Set(prev).add(chatId));
      }
    }

    socket.on("whatsapp:contacts-synced", onContactsSynced);
    socket.on("whatsapp:message", onMessage);
    return () => {
      socket.off("whatsapp:contacts-synced", onContactsSynced);
      socket.off("whatsapp:message", onMessage);
    };
  }, [socket, selectedChatId]);

  // Opening a chat clears its own unread indicator.
  useEffect(() => {
    if (!selectedChatId) return;
    setUnreadChatIds((prev) => {
      if (!prev.has(selectedChatId)) return prev;
      const next = new Set(prev);
      next.delete(selectedChatId);
      return next;
    });
  }, [selectedChatId]);

  const filteredContacts = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return contacts;

    // Phone search ignores formatting, so "(11) 99999-9999" also matches a
    // contactId stored as plain digits.
    const termDigits = term.replace(/\D/g, "");

    return contacts.filter((contact) => {
      const displayName =
        contact.name ?? contact.pushname ?? contact.formattedName ?? contact.contactId;
      const contactDigits = contact.contactId.replace(/\D/g, "");

      return (
        displayName.toLowerCase().includes(term) ||
        contact.contactId.toLowerCase().includes(term) ||
        (termDigits.length > 0 && contactDigits.includes(termDigits))
      );
    });
  }, [contacts, filter]);

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div className="shrink-0 space-y-3 border-b border-border/70 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-lg font-semibold">Conversas</h1>
          <span className="text-xs tabular-nums text-muted-foreground">
            {loading ? "Carregando..." : `${contacts.length} contato(s)`}
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar nome ou celular..."
            className="h-9 rounded-lg bg-muted/40 pl-9"
            aria-label="Buscar contato"
          />
        </div>
      </div>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2">
        {loading && (
          <div className="flex justify-center py-10">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        )}
        {!loading && contacts.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">Nenhum contato sincronizado ainda.</p>
        )}
        {!loading && contacts.length > 0 && filteredContacts.length === 0 && (
          <p className="px-3 py-10 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>
        )}
        <ul className="space-y-0.5">
          {filteredContacts.map((contact) => {
            const displayName =
              contact.name ?? contact.pushname ?? contact.formattedName ?? contact.contactId;
            const isSelected = selectedChatId === contact.contactId;
            const unread = unreadChatIds.has(contact.contactId);
            const waitingAttendant = pendingChatIds.has(contact.contactId);

            return (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(contact.contactId, displayName)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                    isSelected ? "bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isSelected ? "bg-white/15" : "border bg-muted/60 text-foreground",
                    )}
                  >
                    {initials(displayName)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>{displayName}</p>
                    <p
                      className={cn(
                        "truncate text-xs",
                        isSelected ? "text-primary-foreground/60" : "text-muted-foreground",
                      )}
                    >
                      {contact.isGroup
                        ? "Grupo"
                        : formatPhone(contact.contactId.split("@")[0]) || contact.contactId}
                      {contact.isBusiness ? " · Empresa" : ""}
                    </p>
                  </div>
                  {waitingAttendant ? (
                    <span
                      title="Pediu atendimento humano: o agente foi desativado"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-500 text-white ring-4 ring-red-500/15"
                    >
                      <Headset className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
