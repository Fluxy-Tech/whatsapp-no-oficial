import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useSocket } from "@/providers/SocketProvider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle>Contatos</CardTitle>
        <CardDescription>
          {loading ? "Carregando..." : `${contacts.length} contato(s) sincronizado(s) do WhatsApp.`}
        </CardDescription>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por nome ou celular..."
          className="mt-2"
        />
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {!loading && contacts.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum contato sincronizado ainda.</p>
        )}
        {!loading && contacts.length > 0 && filteredContacts.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum contato encontrado.</p>
        )}
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {filteredContacts.map((contact) => {
            const displayName =
              contact.name ?? contact.pushname ?? contact.formattedName ?? contact.contactId;
            const isSelected = selectedChatId === contact.contactId;

            return (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(contact.contactId, displayName)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent",
                    isSelected && "bg-accent",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{displayName}</p>
                    <p className="truncate text-xs text-muted-foreground">{contact.contactId}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {contact.isGroup && <Badge variant="secondary">Grupo</Badge>}
                    {contact.isBusiness && <Badge variant="outline">Empresa</Badge>}
                    {unreadChatIds.has(contact.contactId) && (
                      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-green-500" />
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
