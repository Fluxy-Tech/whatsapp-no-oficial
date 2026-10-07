import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { prisma } from "./prisma";
import { isAdminEmail } from "./roles";

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:6803";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:6802",
  trustedOrigins: [frontendUrl],
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      // Members and invites are managed by /api/organizations (see
      // services/organization.service.ts); these hooks only guarantee that
      // better-auth's own endpoints never hand out the "admin" role.
      creatorRole: "gerente",
      organizationHooks: {
        beforeAddMember: async ({ member, user }) => {
          if (member.role === "admin" && !isAdminEmail(user.email)) {
            throw new APIError("FORBIDDEN", { message: "Only the platform administrator can be admin" });
          }
        },
        beforeUpdateMemberRole: async ({ newRole, user }) => {
          if (newRole === "admin" && !isAdminEmail(user.email)) {
            throw new APIError("FORBIDDEN", { message: "Only the platform administrator can be admin" });
          }
        },
        beforeCreateInvitation: async ({ invitation }) => {
          if (invitation.role === "admin") {
            throw new APIError("FORBIDDEN", { message: "Only the platform administrator can be admin" });
          }
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
