import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { ASSIGNABLE_ROLES, roleLabel, type Invitation, type Member } from "@/lib/organization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OptionsSelect } from "@/components/ui/options-select";
import { Switch } from "@/components/ui/switch";

type MembersCardProps = {
  /** Edit access to settings: flags (events / leads). */
  canEdit: boolean;
  /** gerente/admin: roles, removal and invites. */
  canManage: boolean;
};

const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({ value: role, label: roleLabel(role) }));

const DATE_FORMAT = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

export function MembersCard({ canEdit, canManage }: MembersCardProps) {
  const { data: session } = authClient.useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invite, setInvite] = useState({ email: "", role: "atendente" });
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMembers(await api<Member[]>("/api/organizations/current/members"));
    if (canManage) setInvitations(await api<Invitation[]>("/api/organizations/current/invitations"));
  }, [canManage]);

  useEffect(() => {
    load().catch((err) => setError((err as Error).message));
  }, [load]);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function updateMember(member: Member, patch: Partial<Pick<Member, "role" | "acceptsEvents" | "acceptsLeads">>) {
    setError(null);
    // Instant feedback on the switches; reverted by reloading if the save fails.
    setMembers((current) => current.map((m) => (m.id === member.id ? { ...m, ...patch } : m)));
    try {
      setMembers(
        await api<Member[]>(`/api/organizations/current/members/${member.id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      );
    } catch (err) {
      setError((err as Error).message);
      await load().catch(() => {});
    }
  }

  async function removeMember(member: Member) {
    if (!confirm(`Remover ${member.name} da empresa?`)) return;
    await run(async () =>
      setMembers(await api<Member[]>(`/api/organizations/current/members/${member.id}`, { method: "DELETE" })),
    );
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    await run(async () => {
      const created = await api<Invitation>("/api/organizations/current/invitations", {
        method: "POST",
        body: JSON.stringify(invite),
      });
      setInvitations((current) => [created, ...current.filter((i) => i.email !== created.email)]);
      setInvite({ email: "", role: invite.role });
    });
    setSending(false);
  }

  async function cancelInvite(invitation: Invitation) {
    await run(async () => {
      await api(`/api/organizations/current/invitations/${invitation.id}`, { method: "DELETE" });
      setInvitations((current) => current.filter((i) => i.id !== invitation.id));
    });
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked: the code is on screen anyway.
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Membros</CardTitle>
        <CardDescription>
          Defina quem recebe reuniões do calendário (agendadas pela IA ou pela equipe) e quem participa da distribuição
          de novos leads no quadro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Membro</th>
                <th className="px-3 py-2 font-medium">Cargo</th>
                <th className="px-3 py-2 text-center font-medium">Recebe eventos</th>
                <th className="px-3 py-2 text-center font-medium">Recebe leads</th>
                {canManage && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => {
                const isAdmin = member.role === "admin";
                const isMe = member.userId === session?.user.id;
                return (
                  <tr key={member.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium">
                        {member.name}
                        {isMe && <span className="text-muted-foreground"> (você)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">{member.email}</p>
                    </td>
                    <td className="px-3 py-2">
                      {canManage && !isAdmin ? (
                        <OptionsSelect
                          value={member.role}
                          onValueChange={(role) => void updateMember(member, { role })}
                          size="sm"
                          className="w-36"
                          aria-label="Cargo"
                          options={ROLE_OPTIONS}
                        />
                      ) : (
                        <Badge variant={isAdmin ? "default" : "secondary"}>{roleLabel(member.role)}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={member.acceptsEvents}
                        onCheckedChange={(acceptsEvents) => void updateMember(member, { acceptsEvents })}
                        disabled={!canEdit}
                        aria-label="Recebe eventos do calendário"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Switch
                        checked={member.acceptsLeads}
                        onCheckedChange={(acceptsLeads) => void updateMember(member, { acceptsLeads })}
                        disabled={!canEdit}
                        aria-label="Recebe leads"
                      />
                    </td>
                    {canManage && (
                      <td className="px-3 py-2 text-right">
                        {!isAdmin && !isMe && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => void removeMember(member)}
                            aria-label={`Remover ${member.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {canManage && (
          <div className="space-y-4 border-t pt-6">
            <div>
              <p className="text-sm font-medium">Convidar pessoa</p>
              <p className="text-xs text-muted-foreground">
                Gera um código de convite. Envie o código para a pessoa: depois de entrar com o mesmo e-mail, ela usa o
                código na tela de escolha de empresa. O convite vale por 7 dias.
              </p>
            </div>
            <form onSubmit={sendInvite} className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1 space-y-1">
                <Label htmlFor="invite-email">E-mail</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                  placeholder="pessoa@empresa.com"
                  required
                />
              </div>
              <div className="w-40 space-y-1">
                <Label htmlFor="invite-role">Cargo</Label>
                <OptionsSelect
                  id="invite-role"
                  value={invite.role}
                  onValueChange={(role) => setInvite({ ...invite, role })}
                  options={ROLE_OPTIONS}
                />
              </div>
              <Button type="submit" disabled={sending || !invite.email.trim()}>
                <Send className="h-4 w-4" />
                {sending ? "Gerando..." : "Gerar convite"}
              </Button>
            </form>

            {invitations.length > 0 && (
              <ul className="divide-y rounded-md border">
                {invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{invitation.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {roleLabel(invitation.role)} · expira em {DATE_FORMAT.format(new Date(invitation.expiresAt))}
                      </p>
                    </div>
                    {invitation.code && (
                      <button
                        type="button"
                        onClick={() => void copyCode(invitation.code!)}
                        className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1 font-mono text-sm tracking-widest hover:bg-accent"
                        title="Copiar código"
                      >
                        {invitation.code}
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    )}
                    {copied === invitation.code && <span className="text-xs text-muted-foreground">Copiado</span>}
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void cancelInvite(invitation)}>
                      Cancelar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
