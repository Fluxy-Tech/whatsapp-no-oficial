import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight, KeyRound, LogOut, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { roleLabel, type OrganizationSummary } from "@/lib/organization";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import logo from "@/assets/getleads-marca.png";

/** After login: pick the business to enter, create one or join with an invite code. */
export function OrganizationSelectPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [entering, setEntering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  useEffect(() => {
    api<OrganizationSummary[]>("/api/organizations")
      .then(setOrganizations)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function enter(organizationId: string) {
    setEntering(organizationId);
    setError(null);
    try {
      await api(`/api/organizations/${organizationId}/enter`, { method: "POST" });
      const { error: activeError } = await authClient.organization.setActive({ organizationId });
      if (activeError) throw new Error(activeError.message ?? "Não foi possível acessar a empresa");
      navigate("/dashboard");
    } catch (err) {
      setError((err as Error).message);
      setEntering(null);
    }
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy("create");
    setError(null);
    try {
      const created = await api<OrganizationSummary>("/api/organizations", {
        method: "POST",
        body: JSON.stringify({ name: newName }),
      });
      await enter(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy("join");
    setError(null);
    try {
      const joined = await api<OrganizationSummary>("/api/organizations/invitations/accept", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      await enter(joined.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    navigate("/login");
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-muted/40">
      <div className="bg-grid-light pointer-events-none absolute inset-x-0 top-0 h-[28rem]" />
      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <img src={logo} alt="GetLeads" className="h-8 w-auto" />
        <div className="flex items-center gap-3">
          {session && (
            <span className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <MemberAvatar
                id={session.user.id}
                name={session.user.name}
                image={session.user.image}
                className="h-8 w-8 text-[11px] ring-0"
              />
              <span className="max-w-48 truncate">{session.user.email}</span>
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </header>

      <div className="relative mx-auto w-full max-w-3xl animate-fade-up space-y-8 px-4 pb-16 pt-6 sm:pt-10">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">{session?.user.name ? `Olá, ${session.user.name}` : "Olá"}</p>
          <h1 className="mt-1 text-3xl font-semibold sm:text-4xl">
            Escolha a <span className="font-display font-normal italic">empresa</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Selecione qual empresa você quer acessar.</p>
        </div>

        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">{error}</p>
        )}

        {/* Companies */}
        <div className="relative overflow-hidden rounded-2xl bg-zinc-950 p-6 text-white shadow-float sm:p-7">
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
          <div className="relative">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-white/50">Suas empresas</p>
              {!loading && organizations.length > 0 && (
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs tabular-nums text-white/70">
                  {organizations.length}
                </span>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <Spinner className="size-6 text-white/60" />
              </div>
            ) : organizations.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
                  <Building2 className="h-5 w-5" />
                </span>
                <p className="font-medium">Nenhuma empresa ainda</p>
                <p className="max-w-sm text-sm text-white/60">
                  Crie a sua ou entre com um código de convite logo abaixo.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {organizations.map((organization) => (
                  <li key={organization.id}>
                    <button
                      type="button"
                      onClick={() => enter(organization.id)}
                      disabled={entering !== null}
                      className="group flex w-full items-center gap-4 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3.5 text-left transition-all hover:border-white/25 hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/20 disabled:opacity-60"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white font-display text-xl italic text-zinc-950">
                        {organization.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{organization.name}</span>
                        <span className="block text-xs text-white/50">{roleLabel(organization.role)}</span>
                      </span>
                      {entering === organization.id ? (
                        <Spinner className="size-4 text-white" />
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-white/50 transition-colors group-hover:text-white">
                          <span className="hidden sm:inline">Entrar</span>
                          <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Plus className="h-5 w-5" />
                </span>
                <div className="space-y-1.5">
                  <CardTitle>Criar empresa</CardTitle>
                  <CardDescription>Você será o gerente dela.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="new-organization">Nome da empresa</Label>
                  <Input
                    id="new-organization"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex.: Clínica Bem Estar"
                    disabled={busy !== null}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy !== null || !newName.trim()}>
                  {busy === "create" ? "Criando..." : "Criar empresa"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-muted/50 text-foreground">
                  <KeyRound className="h-5 w-5" />
                </span>
                <div className="space-y-1.5">
                  <CardTitle>Entrar com convite</CardTitle>
                  <CardDescription>Use o código que o gerente da empresa compartilhou com você.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleJoin} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="invite-code">Código de convite</Label>
                  <Input
                    id="invite-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="Ex.: K7M2Q9XA"
                    className="font-mono tracking-widest"
                    disabled={busy !== null}
                  />
                </div>
                <Button type="submit" variant="outline" className="w-full" disabled={busy !== null || !code.trim()}>
                  {busy === "join" ? "Entrando..." : "Entrar na empresa"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
