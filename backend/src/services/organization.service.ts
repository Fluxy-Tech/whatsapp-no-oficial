import { randomInt } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  CONFIGURABLE_ROLES,
  isAdminEmail,
  isAssignableRole,
  isConfigurableRole,
  isManagerRole,
  normalizePermissions,
  permissionsFor,
  type AssignableRole,
  type ConfigurableRole,
  type Permissions,
} from "../lib/roles";

export class OrganizationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type SessionUser = { id: string; email: string; name: string };

const INVITATION_TTL_DAYS = 7;
// No 0/O, 1/I/L: the code is typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

async function storedPermissions(organizationId: string) {
  const rows = await prisma.organizationRolePermission.findMany({ where: { organizationId } });
  return Object.fromEntries(rows.map((row) => [row.role, row.permissions])) as Partial<Record<ConfigurableRole, unknown>>;
}

export async function getRolePermissions(organizationId: string, role: string): Promise<Permissions> {
  if (isManagerRole(role)) return permissionsFor(role, {});
  return permissionsFor(role, await storedPermissions(organizationId));
}

/** Access of the configurable roles (supervisor, atendente). */
export async function listRolePermissions(organizationId: string) {
  const stored = await storedPermissions(organizationId);
  return Object.fromEntries(
    CONFIGURABLE_ROLES.map((role) => [role, normalizePermissions(role, stored[role])]),
  ) as Record<ConfigurableRole, Permissions>;
}

export async function updateRolePermissions(organizationId: string, role: string, permissions: unknown) {
  if (!isConfigurableRole(role)) throw new OrganizationError(400, "Só é possível configurar supervisor e atendente");
  const normalized = normalizePermissions(role, permissions) as unknown as Prisma.InputJsonValue;
  await prisma.organizationRolePermission.upsert({
    where: { organizationId_role: { organizationId, role } },
    create: { organizationId, role, permissions: normalized },
    update: { permissions: normalized },
  });
  return listRolePermissions(organizationId);
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

function slugify(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "empresa"}-${randomInt(36 ** 4).toString(36).padStart(4, "0")}`;
}

/** Organizations the user can enter. The platform admin sees all of them. */
export async function listUserOrganizations(user: SessionUser) {
  if (isAdminEmail(user.email)) {
    const organizations = await prisma.organization.findMany({
      orderBy: { name: "asc" },
      include: { members: { where: { userId: user.id }, select: { role: true } } },
    });
    return organizations.map((org) => ({ id: org.id, name: org.name, role: "admin" }));
  }

  const members = await prisma.member.findMany({
    where: { userId: user.id },
    include: { organization: true },
    orderBy: { organization: { name: "asc" } },
  });
  return members.map((member) => ({ id: member.organization.id, name: member.organization.name, role: member.role }));
}

export async function createOrganization(user: SessionUser, rawName: unknown) {
  const name = String(rawName ?? "").trim();
  if (!name) throw new OrganizationError(400, "Informe o nome da empresa");

  const organization = await prisma.organization.create({
    data: {
      name,
      slug: slugify(name),
      members: { create: { userId: user.id, role: isAdminEmail(user.email) ? "admin" : "gerente" } },
    },
  });
  return { id: organization.id, name: organization.name };
}

/**
 * Called before better-auth's setActive: makes sure the user is a member.
 * The platform admin becomes (or stays) "admin" of whatever organization it enters.
 */
export async function ensureCanEnter(user: SessionUser, organizationId: string) {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new OrganizationError(404, "Empresa não encontrada");

  if (isAdminEmail(user.email)) {
    await prisma.member.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: { organizationId, userId: user.id, role: "admin" },
      update: { role: "admin" },
    });
    return;
  }

  const member = await prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId: user.id } } });
  if (!member) throw new OrganizationError(403, "Você não é membro desta empresa");
}

export async function renameOrganization(organizationId: string, rawName: unknown) {
  const name = String(rawName ?? "").trim();
  if (!name) throw new OrganizationError(400, "Informe o nome da empresa");
  const organization = await prisma.organization.update({ where: { id: organizationId }, data: { name } });
  return { id: organization.id, name: organization.name };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(organizationId: string) {
  const members = await prisma.member.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });
  return members.map((member) => ({
    id: member.id,
    userId: member.userId,
    name: member.user.name,
    image: member.user.image,
    email: member.user.email,
    role: member.role,
    acceptsEvents: member.acceptsEvents,
    acceptsLeads: member.acceptsLeads,
    createdAt: member.createdAt,
  }));
}

export type MemberUpdate = { role?: unknown; acceptsEvents?: unknown; acceptsLeads?: unknown };

/**
 * Role changes need a manager (checked by the route through `canManage`);
 * the calendar/lead flags only need edit access to settings.
 */
export async function updateMember(organizationId: string, memberId: string, update: MemberUpdate, canManage: boolean) {
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw new OrganizationError(404, "Membro não encontrado");

  const data: Prisma.MemberUpdateInput = {};
  if (update.acceptsEvents !== undefined) data.acceptsEvents = Boolean(update.acceptsEvents);
  if (update.acceptsLeads !== undefined) data.acceptsLeads = Boolean(update.acceptsLeads);

  if (update.role !== undefined && update.role !== member.role) {
    if (!canManage) throw new OrganizationError(403, "Só o gerente pode alterar cargos");
    if (member.role === "admin") throw new OrganizationError(400, "O cargo do administrador não pode ser alterado");
    if (!isAssignableRole(update.role)) throw new OrganizationError(400, "Cargo inválido");
    if (member.role === "gerente") await ensureAnotherManager(organizationId, member.id);
    data.role = update.role;
  }

  await prisma.member.update({ where: { id: member.id }, data });
  return listMembers(organizationId);
}

async function ensureAnotherManager(organizationId: string, memberId: string) {
  const others = await prisma.member.count({ where: { organizationId, role: "gerente", id: { not: memberId } } });
  if (!others) throw new OrganizationError(400, "A empresa precisa ter pelo menos um gerente");
}

export async function removeMember(organizationId: string, memberId: string) {
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
  if (!member) throw new OrganizationError(404, "Membro não encontrado");
  if (member.role === "admin") throw new OrganizationError(400, "O administrador não pode ser removido");
  if (member.role === "gerente") await ensureAnotherManager(organizationId, member.id);
  await prisma.member.delete({ where: { id: member.id } });
  return listMembers(organizationId);
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

function generateCode() {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

const invitationView = (invitation: {
  id: string;
  email: string;
  role: string | null;
  code: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}) => ({
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  code: invitation.code,
  status: invitation.status,
  expiresAt: invitation.expiresAt,
  createdAt: invitation.createdAt,
});

export async function listInvitations(organizationId: string) {
  const invitations = await prisma.invitation.findMany({
    where: { organizationId, status: "pending", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  return invitations.map(invitationView);
}

export async function createInvitation(organizationId: string, inviterId: string, rawEmail: unknown, role: unknown) {
  const email = String(rawEmail ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrganizationError(400, "E-mail inválido");
  if (isAdminEmail(email)) throw new OrganizationError(400, "Este e-mail é do administrador da plataforma");
  if (!isAssignableRole(role)) throw new OrganizationError(400, "Cargo inválido");

  const alreadyMember = await prisma.member.findFirst({ where: { organizationId, user: { email } } });
  if (alreadyMember) throw new OrganizationError(409, "Esta pessoa já é membro da empresa");

  // A new invite for the same e-mail replaces the pending one.
  await prisma.invitation.updateMany({
    where: { organizationId, email, status: "pending" },
    data: { status: "canceled" },
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const invitation = await prisma.invitation.create({
        data: {
          organizationId,
          inviterId,
          email,
          role: role as AssignableRole,
          code: generateCode(),
          expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
        },
      });
      return invitationView(invitation);
    } catch (error) {
      // Code collision (unique index): try another one.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new OrganizationError(500, "Não foi possível gerar o código do convite");
}

export async function cancelInvitation(organizationId: string, invitationId: string) {
  const { count } = await prisma.invitation.updateMany({
    where: { id: invitationId, organizationId, status: "pending" },
    data: { status: "canceled" },
  });
  if (!count) throw new OrganizationError(404, "Convite não encontrado");
}

/** The logged-in user joins the organization of the invite (the e-mail must match). */
export async function acceptInvitation(user: SessionUser, rawCode: unknown) {
  const code = String(rawCode ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!code) throw new OrganizationError(400, "Informe o código do convite");

  const invitation = await prisma.invitation.findUnique({ where: { code }, include: { organization: true } });
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date()) {
    throw new OrganizationError(404, "Convite inválido ou expirado");
  }
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new OrganizationError(403, "Este convite foi enviado para outro e-mail");
  }

  const role = isAssignableRole(invitation.role) ? invitation.role : "atendente";
  await prisma.$transaction([
    prisma.member.upsert({
      where: { organizationId_userId: { organizationId: invitation.organizationId, userId: user.id } },
      create: { organizationId: invitation.organizationId, userId: user.id, role },
      update: {},
    }),
    prisma.invitation.update({ where: { id: invitation.id }, data: { status: "accepted" } }),
  ]);

  return { id: invitation.organization.id, name: invitation.organization.name, role };
}
