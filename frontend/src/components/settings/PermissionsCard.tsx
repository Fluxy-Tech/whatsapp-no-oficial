import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  ACCESS_LABELS,
  CONFIGURABLE_ROLES,
  MODULE_LABELS,
  MODULES,
  roleLabel,
  type AccessLevel,
  type ConfigurableRole,
  type Module,
  type Permissions,
} from "@/lib/organization";
import { useOrganization } from "@/providers/OrganizationProvider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OptionsSelect } from "@/components/ui/options-select";

const ACCESS_OPTIONS = (Object.keys(ACCESS_LABELS) as AccessLevel[]).map((level) => ({
  value: level,
  label: ACCESS_LABELS[level],
}));

type Matrix = Record<ConfigurableRole, Permissions>;

/** What supervisor and atendente can see/edit. Only the gerente (and admin) see this card. */
export function PermissionsCard() {
  const { refresh } = useOrganization();
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    api<Matrix>("/api/organizations/current/permissions")
      .then(setMatrix)
      .catch((err) => setError((err as Error).message));
  }, []);

  async function change(role: ConfigurableRole, module: Module, level: AccessLevel) {
    if (!matrix) return;
    const permissions = { ...matrix[role], [module]: level };
    setMatrix({ ...matrix, [role]: permissions });
    setError(null);
    try {
      setMatrix(
        await api<Matrix>(`/api/organizations/current/permissions/${role}`, {
          method: "PUT",
          body: JSON.stringify({ permissions }),
        }),
      );
      setSavedAt(Date.now());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Acessos por cargo</CardTitle>
        <CardDescription>
          Defina o que supervisores e atendentes podem ver ou editar. Gerentes têm acesso total. As alterações são salvas
          na hora.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {matrix && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Área</th>
                  {CONFIGURABLE_ROLES.map((role) => (
                    <th key={role} className="px-3 py-2 font-medium">
                      {roleLabel(role)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {MODULES.map((module) => (
                  <tr key={module}>
                    <td className="px-3 py-2 font-medium">{MODULE_LABELS[module]}</td>
                    {CONFIGURABLE_ROLES.map((role) => (
                      <td key={role} className="px-3 py-2">
                        <OptionsSelect
                          value={matrix[role][module]}
                          onValueChange={(level) => void change(role, module, level as AccessLevel)}
                          size="sm"
                          className="w-40"
                          aria-label={`${MODULE_LABELS[module]} — ${roleLabel(role)}`}
                          options={ACCESS_OPTIONS}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {savedAt && <p className="text-xs text-muted-foreground">Salvo</p>}
      </CardContent>
    </Card>
  );
}
