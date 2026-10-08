export type Role = "admin" | "gerente" | "supervisor" | "atendente";
export type AssignableRole = Exclude<Role, "admin">;
export type ConfigurableRole = "supervisor" | "atendente";

/** dashboard = reports; crm = board (quadro) and calendar. */
export type Module = "dashboard" | "crm" | "conversas" | "leads" | "agentes" | "configuracoes";
export type AccessLevel = "none" | "view" | "edit";
export type Permissions = Record<Module, AccessLevel>;

export const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  supervisor: "Supervisor",
  atendente: "Atendente",
};

export const ASSIGNABLE_ROLES: AssignableRole[] = ["gerente", "supervisor", "atendente"];
export const CONFIGURABLE_ROLES: ConfigurableRole[] = ["supervisor", "atendente"];

export const MODULE_LABELS: Record<Module, string> = {
  dashboard: "Dashboard",
  crm: "CRM (Quadro e Calendário)",
  conversas: "Conversas",
  leads: "Leads",
  agentes: "Agentes de IA",
  configuracoes: "Configurações",
};

export const MODULES = Object.keys(MODULE_LABELS) as Module[];

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  none: "Sem acesso",
  view: "Só ver",
  edit: "Ver e editar",
};

export type CurrentOrganization = {
  organization: {
    id: string;
    name: string;
    /** Seconds the agent waits for the contact to stop sending messages. */
    messageWaitSeconds: number;
  };
  role: string;
  permissions: Permissions;
  isAdmin: boolean;
  /** admin or gerente: members, invites and access. */
  canManage: boolean;
};

export type OrganizationSummary = { id: string; name: string; role: string };

export type Member = {
  id: string;
  userId: string;
  name: string;
  email: string;
  /** Profile photo path (see MemberAvatar). */
  image: string | null;
  role: string;
  acceptsEvents: boolean;
  acceptsLeads: boolean;
  createdAt: string;
};

export type Invitation = {
  id: string;
  email: string;
  role: string | null;
  code: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
};

export const roleLabel = (role: string | null | undefined) => (role ? (ROLE_LABELS[role] ?? role) : "Membro");
