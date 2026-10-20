import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { roleLabel } from "@/lib/organization";
import { useOrganization } from "@/providers/OrganizationProvider";
import { MemberAvatar } from "@/components/dashboard/MemberAvatar";
import { NameForm } from "@/components/settings/NameForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { confirmAction } from "@/components/ui/confirm-dialog";

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** /dashboard/perfil: e-mail, user name and profile photo of the logged user. */
export function ProfilePage() {
  const { data: session } = authClient.useSession();
  const { current } = useOrganization();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const user = session?.user;

  async function changePhoto(file: File) {
    if (!file.type.startsWith("image/")) return setError("Escolha um arquivo de imagem.");
    if (file.size > MAX_PHOTO_BYTES) return setError("Imagem muito grande (máx. 5MB).");
    setBusy("upload");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const { image } = await api<{ image: string }>("/api/profile/avatar", { method: "POST", body });
      // Saved through better-auth so the session (sidebar, etc.) updates right away.
      const { error: updateError } = await authClient.updateUser({ image });
      if (updateError) throw new Error(updateError.message ?? "Não foi possível salvar a foto");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    const confirmed = await confirmAction({ title: "Remover sua foto de perfil?", confirmLabel: "Remover", destructive: true });
    if (!confirmed) return;
    setBusy("remove");
    setError(null);
    try {
      await api("/api/profile/avatar", { method: "DELETE" });
      const { error: updateError } = await authClient.updateUser({ image: null });
      if (updateError) throw new Error(updateError.message ?? "Não foi possível remover a foto");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8">
      <PageHeader eyebrow="Conta" title="Perfil" description="Seus dados de acesso e como você aparece para a equipe." />

      {/* Identity: photo, name, e-mail and role in the active company. */}
      <div className="relative overflow-hidden rounded-2xl bg-zinc-950 p-6 text-white shadow-float sm:p-8">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy !== null}
            className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30"
            aria-label={user?.image ? "Trocar foto" : "Enviar foto"}
            title={user?.image ? "Trocar foto" : "Enviar foto"}
          >
            <MemberAvatar
              id={user?.id ?? "me"}
              name={user?.name}
              image={user?.image}
              className="h-24 w-24 text-2xl ring-4 ring-white/10"
            />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-6 w-6" />
            </span>
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
                <Spinner className="size-6" />
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-2xl font-semibold sm:text-3xl">
              {user?.name ?? <span className="font-display font-normal italic text-white/70">Sem nome</span>}
            </p>
            <p className="mt-1 truncate text-sm text-white/60">{user?.email}</p>
            {current && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-950">
                  {roleLabel(current.role)}
                </span>
                <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs text-white/70">
                  {current.organization.name}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="bg-white text-zinc-950 hover:bg-white/90"
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
            >
              <Camera className="h-4 w-4" />
              {user?.image ? "Trocar foto" : "Enviar foto"}
            </Button>
            {user?.image && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => void removePhoto()}
                disabled={busy !== null}
              >
                <Trash2 className="h-4 w-4" />
                Remover
              </Button>
            )}
          </div>
        </div>
        <p className="relative mt-5 text-xs text-white/40">
          A foto aparece no menu, nos cards do quadro e nos comentários. JPG, PNG, WEBP ou GIF até 5MB.
        </p>
        {error && <p className="relative mt-2 text-sm text-red-300">{error}</p>}
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void changePhoto(file);
          }}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dados da conta</CardTitle>
          <CardDescription>Como você entra na plataforma e o nome que a equipe vê.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="profile-email">E-mail</Label>
            <Input id="profile-email" type="email" value={user?.email ?? ""} disabled readOnly />
            <p className="text-xs text-muted-foreground">O e-mail é usado para entrar e não pode ser alterado aqui.</p>
          </div>
          <NameForm
            id="profile-name"
            label="Nome de usuário"
            initialValue={user?.name ?? ""}
            onSave={(name) => authClient.updateUser({ name })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
