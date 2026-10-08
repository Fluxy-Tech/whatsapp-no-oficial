// Roles and per-module permissions of an organization.
//
// - admin: the platform administrator. Only ADMIN_EMAIL can hold it, and it
//   can enter any organization with full access.
// - gerente: full access; manages members, invites and what the other roles can do.
// - supervisor / atendente: access defined by the gerente per module.

export const ADMIN_EMAIL = "sturnusflow@gmail.com";

export const ROLES = ["admin", "gerente", "supervisor", "atendente"] as const;
export type Role = (typeof ROLES)[number];

/** Roles that can be given through invites or by the gerente (never "admin"). */
export const ASSIGNABLE_ROLES = ["gerente", "supervisor", "atendente"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Roles whose access the gerente configures. */
export const CONFIGURABLE_ROLES = ["supervisor", "atendente"] as const;
export type ConfigurableRole = (typeof CONFIGURABLE_ROLES)[number];

// dashboard = reports; crm = board (quadro) and calendar.
export const MODULES = ["dashboard", "crm", "conversas", "leads", "campanhas", "agentes", "configuracoes"] as const;
export type Module = (typeof MODULES)[number];

export const ACCESS_LEVELS = ["none", "view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export type Permissions = Record<Module, AccessLevel>;

const FULL_ACCESS: Permissions = {
  dashboard: "edit",
  crm: "edit",
  conversas: "edit",
  leads: "edit",
  campanhas: "edit",
  agentes: "edit",
  configuracoes: "edit",
};

/** Used until the gerente changes them. */
export const DEFAULT_PERMISSIONS: Record<ConfigurableRole, Permissions> = {
  supervisor: {
    dashboard: "view",
    crm: "edit",
    conversas: "edit",
    leads: "edit",
    campanhas: "edit",
    agentes: "view",
    configuracoes: "view",
  },
  atendente: {
    dashboard: "view",
    crm: "edit",
    conversas: "edit",
    leads: "view",
    campanhas: "none",
    agentes: "none",
    configuracoes: "none",
  },
};

const LEVEL_RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export const isAdminEmail = (email: string | null | undefined) =>
  (email ?? "").trim().toLowerCase() === ADMIN_EMAIL;

export const isAssignableRole = (role: unknown): role is AssignableRole =>
  typeof role === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(role);

export const isConfigurableRole = (role: unknown): role is ConfigurableRole =>
  typeof role === "string" && (CONFIGURABLE_ROLES as readonly string[]).includes(role);

/** admin and gerente manage members, invites and permissions. */
export const isManagerRole = (role: string | null | undefined) => role === "admin" || role === "gerente";

export function hasAccess(permissions: Permissions, module: Module, level: AccessLevel) {
  return LEVEL_RANK[permissions[module] ?? "none"] >= LEVEL_RANK[level];
}

/** Validates/completes a stored permissions object; unknown values fall back to the defaults. */
export function normalizePermissions(role: ConfigurableRole, value: unknown): Permissions {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const result = { ...DEFAULT_PERMISSIONS[role] };
  for (const module of MODULES) {
    const level = raw[module];
    if (typeof level === "string" && (ACCESS_LEVELS as readonly string[]).includes(level)) {
      result[module] = level as AccessLevel;
    }
  }
  return result;
}

/** Permissions of a role, given what the gerente stored for the configurable ones. */
export function permissionsFor(role: string, stored: Partial<Record<ConfigurableRole, unknown>>): Permissions {
  if (isManagerRole(role)) return { ...FULL_ACCESS };
  if (isConfigurableRole(role)) return normalizePermissions(role, stored[role]);
  // Unknown/legacy role: no access until the gerente fixes it.
  return {
    dashboard: "none",
    crm: "none",
    conversas: "none",
    leads: "none",
    campanhas: "none",
    agentes: "none",
    configuracoes: "none",
  };
}
