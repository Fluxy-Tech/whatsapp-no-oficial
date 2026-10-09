import { Router, type NextFunction, type Request, type Response } from "express";
import { isAdminEmail, isManagerRole } from "../lib/roles";
import { requireAuth, requireManager, requireMember, requirePermission } from "../middleware/auth";
import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  createOrganization,
  ensureCanEnter,
  listInvitations,
  listMembers,
  listRolePermissions,
  listUserOrganizations,
  OrganizationError,
  removeMember,
  renameOrganization,
  updateOrganizationSettings,
  updateMember,
  updateRolePermissions,
} from "../services/organization.service";
import { prisma } from "../lib/prisma";

const router = Router();

router.use(requireAuth);

const user = (req: Request) => req.session!.user;
const organizationId = (req: Request) => req.member!.organizationId;

// ---- Organizations the user can enter (selection screen) -------------------

router.get("/", async (req, res) => {
  res.json(await listUserOrganizations(user(req)));
});

router.post("/", async (req, res) => {
  res.status(201).json(await createOrganization(user(req), req.body?.name));
});

// Checked before better-auth's setActive (which only accepts members).
router.post("/:organizationId/enter", async (req, res) => {
  await ensureCanEnter(user(req), String(req.params.organizationId));
  res.json({ ok: true });
});

router.post("/invitations/accept", async (req, res) => {
  res.json(await acceptInvitation(user(req), req.body?.code));
});

// ---- Active organization ---------------------------------------------------

router.get("/current", requireMember, async (req, res) => {
  const member = req.member!;
  const organization = await prisma.organization.findUnique({ where: { id: member.organizationId } });
  res.json({
    organization: {
      id: member.organizationId,
      name: organization?.name ?? "",
      messageWaitSeconds: organization?.messageWaitSeconds ?? 20,
      agentMessageDelaySeconds: organization?.agentMessageDelaySeconds ?? 0,
      agentFailureMessage: organization?.agentFailureMessage ?? null,
      alertPhoneNumber: organization?.alertPhoneNumber ?? null,
    },
    role: member.role,
    permissions: member.permissions,
    isAdmin: isAdminEmail(user(req).email),
    canManage: isManagerRole(member.role),
  });
});

router.patch("/current", requirePermission("configuracoes", "edit"), async (req, res) => {
  res.json(await renameOrganization(organizationId(req), req.body?.name));
});

router.patch("/current/settings", requirePermission("configuracoes", "edit"), async (req, res) => {
  const body = req.body ?? {};
  res.json(
    await updateOrganizationSettings(organizationId(req), {
      messageWaitSeconds: body.messageWaitSeconds,
      agentMessageDelaySeconds: body.agentMessageDelaySeconds,
      agentFailureMessage: body.agentFailureMessage,
      alertPhoneNumber: body.alertPhoneNumber,
    }),
  );
});

// Any member can list members (kanban/calendar assignee pickers).
router.get("/current/members", requireMember, async (req, res) => {
  res.json(await listMembers(organizationId(req)));
});

router.patch("/current/members/:memberId", requirePermission("configuracoes", "edit"), async (req, res) => {
  const canManage = isManagerRole(req.member!.role);
  res.json(await updateMember(organizationId(req), String(req.params.memberId), req.body ?? {}, canManage));
});

router.delete("/current/members/:memberId", requireManager, async (req, res) => {
  res.json(await removeMember(organizationId(req), String(req.params.memberId)));
});

router.get("/current/invitations", requireManager, async (req, res) => {
  res.json(await listInvitations(organizationId(req)));
});

router.post("/current/invitations", requireManager, async (req, res) => {
  const { email, role } = (req.body ?? {}) as { email?: unknown; role?: unknown };
  res.status(201).json(await createInvitation(organizationId(req), user(req).id, email, role));
});

router.delete("/current/invitations/:invitationId", requireManager, async (req, res) => {
  await cancelInvitation(organizationId(req), String(req.params.invitationId));
  res.status(204).end();
});

router.get("/current/permissions", requireManager, async (req, res) => {
  res.json(await listRolePermissions(organizationId(req)));
});

router.put("/current/permissions/:role", requireManager, async (req, res) => {
  res.json(await updateRolePermissions(organizationId(req), String(req.params.role), req.body?.permissions));
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof OrganizationError) return res.status(error.status).json({ error: error.message });
  next(error);
});

export default router;
