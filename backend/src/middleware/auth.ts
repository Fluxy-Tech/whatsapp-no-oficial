import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";
import { hasAccess, isManagerRole, type AccessLevel, type Module, type Permissions } from "../lib/roles";
import { getRolePermissions } from "../services/organization.service";

declare global {
  namespace Express {
    interface Request {
      session?: Awaited<ReturnType<typeof auth.api.getSession>>;
      member?: { id: string; role: string; organizationId: string; userId: string; permissions: Permissions };
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });

  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  req.session = session;
  next();
}

/** Loads the member of the active organization (role + permissions) into req.member. */
export async function requireMember(req: Request, res: Response, next: NextFunction) {
  if (req.member) return next();

  const organizationId = req.session?.session.activeOrganizationId;
  if (!organizationId) {
    return res.status(400).json({ error: "No active organization selected" });
  }

  const member = await prisma.member.findFirst({
    where: { organizationId, userId: req.session!.user.id },
  });
  if (!member) {
    return res.status(403).json({ error: "Você não é membro desta organização" });
  }

  const permissions = await getRolePermissions(organizationId, member.role);
  req.member = { id: member.id, role: member.role, organizationId, userId: member.userId, permissions };
  next();
}

function withMember(check: (member: NonNullable<Request["member"]>) => boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireMember(req, res, () => {
      if (!check(req.member!)) {
        return res.status(403).json({ error: "Seu cargo não tem permissão para esta ação" });
      }
      next();
    }).catch(next);
  };
}

/** The member's role must give at least `level` access to `module`. */
export const requirePermission = (module: Module, level: AccessLevel) =>
  withMember((member) => hasAccess(member.permissions, module, level));

/** admin or gerente: members, invites and access configuration. */
export const requireManager = withMember((member) => isManagerRole(member.role));
