import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight, KeyRound, LogOut, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { roleLabel, type OrganizationSummary } from "@/lib/organization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

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
    <div className="flex min-h-screen items-start justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Escolha a empresa</h1>
            <p className="text-sm text-muted-foreground">
              {session?.user.name ? `Olá, ${session.user.name}. ` : ""}Selecione qual empresa você quer acessar.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Card>
          <CardHeader>
            <CardTitle>Suas empresas</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-6">
                <Spinner className="size-6 text-muted-foreground" />
              </div>
            ) : organizations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Você ainda não participa de nenhuma empresa. Crie a sua ou entre com um código de convite.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {organizations.map((organization) => (
                  <li key={organization.id}>
                    <button
                      type="button"
                      onClick={() => enter(organization.id)}
                      disabled={entering !== null}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent disabled:opacity-60"
                    >
                      <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{organization.name}</span>
                        <span className="block text-xs text-muted-foreground">{roleLabel(organization.role)}</span>
                      </span>
                      {entering === organization.id ? (
                        <Spinner className="size-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Criar empresa</CardTitle>
              <CardDescription>Você será o gerente dela.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="new-organization">Nome da empresa</Label>
                  <Input
                    id="new-organization"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    disabled={busy !== null}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy !== null || !newName.trim()}>
                  <Plus className="h-4 w-4" />
                  {busy === "create" ? "Criando..." : "Criar empresa"}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Entrar com convite</CardTitle>
              <CardDescription>Use o código que o gerente da empresa compartilhou com você.</CardDescription>
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
                  <KeyRound className="h-4 w-4" />
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
