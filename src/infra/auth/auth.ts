import { betterAuth } from "better-auth";
import { prismaAdapter } from "@better-auth/prisma-adapter";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { prisma } from "@/infra/database/client";
import { getEmailAdapter } from "@/infra/email";
import { getServerEnv } from "@/server/env";
import { recordAuditEvent } from "@/server/audit/record";

/**
 * Automotive Brands owns authentication data via Better Auth + PostgreSQL/Prisma.
 * Sessions use HttpOnly cookies (Secure in production, SameSite=lax).
 */
function createAuth() {
  const env = getServerEnv();
  const isProd = env.NODE_ENV === "production";

  return betterAuth({
    appName: "Automotive Brands",
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    database: prismaAdapter(prisma, {
      provider: "postgresql",
    }),
    user: {
      modelName: "user",
      additionalFields: {
        status: {
          type: "string",
          required: false,
          defaultValue: "INVITED",
          input: false,
          returned: true,
        },
        actorType: {
          type: "string",
          required: false,
          defaultValue: "TRADE",
          input: false,
          returned: true,
        },
        mfaEnabled: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
          returned: true,
        },
      },
    },
    session: {
      modelName: "authSession",
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh expiry daily when active
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    account: {
      modelName: "authAccount",
    },
    verification: {
      modelName: "authVerification",
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        const email = getEmailAdapter();
        const result = await email.send({
          to: user.email,
          subject: "Reset your Automotive Brands password",
          text: `Reset your password using this link (expires soon):\n\n${url}\n\nIf you did not request this, ignore this email.`,
          html: `<p>Reset your password using this link (expires soon):</p><p><a href="${url}">${url}</a></p><p>If you did not request this, ignore this email.</p>`,
          tags: { template: "password_reset" },
        });

        await recordAuditEvent({
          action: "PASSWORD_RESET_REQUESTED",
          entityType: "User",
          entityId: user.id,
          actorUserId: user.id,
          metadata: {
            emailAdapter: email.name,
            deliveryOk: result.ok,
            // never store the reset URL or token
          },
        });

        if (!result.ok && isProd) {
          throw new Error("Unable to send password reset email");
        }
      },
      onPasswordReset: async ({ user }) => {
        await recordAuditEvent({
          action: "PASSWORD_RESET_COMPLETED",
          entityType: "User",
          entityId: user.id,
          actorUserId: user.id,
        });
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 20,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: isProd,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
        path: "/",
      },
      database: {
        // Let Prisma @default(cuid()) allocate IDs consistently with Phase 0.
        generateId: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            return {
              data: {
                ...user,
                name: user.name || user.email.split("@")[0] || "User",
              },
            };
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await prisma.user.update({
              where: { id: session.userId },
              data: { lastLoginAt: new Date(), status: "ACTIVE" },
            });
          },
        },
      },
    },
    // Must be last plugin so Set-Cookie is applied via TanStack Start
    plugins: [tanstackStartCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __abAuth?: Auth };

export const auth: Auth = globalForAuth.__abAuth ?? createAuth();

if (process.env["NODE_ENV"] !== "production") {
  globalForAuth.__abAuth = auth;
}

export type SessionUser = typeof auth.$Infer.Session.user;
export type SessionData = typeof auth.$Infer.Session.session;
