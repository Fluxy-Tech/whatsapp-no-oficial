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
import { Spinner } from "@/components/ui/spinner";

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
    if (!confirm("Remover sua foto de perfil?")) return;
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
    <div className="w-full max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Perfil</h1>
        <p className="text-sm text-muted-foreground">Seus dados de acesso e como você aparece para a equipe.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Foto de perfil</CardTitle>
          <CardDescription>Aparece no menu, nos cards do quadro e nos comentários. JPG, PNG, WEBP ou GIF até 5MB.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-6">
          <div className="relative">
            <MemberAvatar id={user?.id ?? "me"} name={user?.name} image={user?.image} className="h-24 w-24 text-2xl" />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
                <Spinner className="size-6" />
              </span>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
                <Camera className="h-4 w-4" />
                {user?.image ? "Trocar foto" : "Enviar foto"}
              </Button>
              {user?.image && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void removePhoto()}
                  disabled={busy !== null}
                >
                  <Trash2 className="h-4 w-4" />
                  Remover
                </Button>
              )}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dados da conta</CardTitle>
          {current && (
            <CardDescription>
              {roleLabel(current.role)} em {current.organization.name}
            </CardDescription>
          )}
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
