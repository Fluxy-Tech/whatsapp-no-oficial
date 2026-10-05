import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";

export type OrgRole = "owner" | "admin" | "member";

declare global {
  namespace Express {
    interface Request {
      session?: Awaited<ReturnType<typeof auth.api.getSession>>;
      member?: { id: string; role: string; organizationId: string };
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

export function requireOrgRole(roles: OrgRole[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const activeOrganizationId = req.session?.session.activeOrganizationId;

    if (!activeOrganizationId) {
      return res.status(400).json({ error: "No active organization selected" });
    }

    const member = await prisma.member.findFirst({
      where: { organizationId: activeOrganizationId, userId: req.session!.user.id },
    });

    if (!member || !roles.includes(member.role as OrgRole)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }

    req.member = { id: member.id, role: member.role, organizationId: member.organizationId };
    next();
  };
}
