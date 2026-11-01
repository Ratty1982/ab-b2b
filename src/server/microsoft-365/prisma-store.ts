/**
 * Prisma adapter. Selects connection health without token columns.
 */
import { Prisma } from "@prisma/client";

import { isOAuthTransactionOpen, oauthTransactionConsumeFilter } from "@/domain/microsoft-365-crm";
import { prisma } from "@/infra/database/client";
import {
  MicrosoftIdentityConflict,
  type Microsoft365Store,
  type StoredConnection,
  type StoredOAuthTransaction,
} from "@/server/microsoft-365/store";

function mapConnection(row: {
  id: string;
  userId: string;
  status: StoredConnection["status"];
  tenantId: string;
  microsoftUserId: string;
  activeIdentityKey: string | null;
  microsoftEmail: string | null;
  displayName: string | null;
  scopes: string;
  taskSyncEnabled: boolean;
  calendarSyncEnabled: boolean;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
  lastTokenRefreshAt: Date | null;
  lastTaskSyncAt: Date | null;
  lastCalendarSyncAt: Date | null;
  lastError: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}): StoredConnection {
  return row;
}

export function createPrismaMicrosoft365Store(): Microsoft365Store {
  return {
    async insertTransaction(row: StoredOAuthTransaction) {
      await prisma.microsoftOAuthTransaction.create({ data: row });
    },
    async consumeTransaction(stateHash, now) {
      const row = await prisma.microsoftOAuthTransaction.findUnique({ where: { stateHash } });
      if (!row || !isOAuthTransactionOpen(row, now)) return null;
      const updated = await prisma.microsoftOAuthTransaction.updateMany({
        where: oauthTransactionConsumeFilter(row.id, now),
        data: { consumedAt: now },
      });
      if (updated.count !== 1) return null;
      return {
        id: row.id,
        userId: row.userId,
        stateHash: row.stateHash,
        codeVerifierEncrypted: row.codeVerifierEncrypted,
        nonce: row.nonce,
        includeCalendar: row.includeCalendar,
        redirectUri: row.redirectUri,
        expiresAt: row.expiresAt,
        consumedAt: now,
      };
    },
    async deleteTransactionsForUser(userId) {
      await prisma.microsoftOAuthTransaction.deleteMany({ where: { userId } });
    },
    async findConnectionByUser(userId) {
      const row = await prisma.microsoftAccountConnection.findUnique({ where: { userId } });
      return row ? mapConnection(row) : null;
    },
    async findActiveIdentity(activeIdentityKey) {
      const row = await prisma.microsoftAccountConnection.findFirst({
        where: { activeIdentityKey, status: "CONNECTED" },
      });
      return row ? mapConnection(row) : null;
    },
    async saveConnection(row) {
      try {
        await prisma.microsoftAccountConnection.upsert({
          where: { userId: row.userId },
          create: row,
          update: row,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new MicrosoftIdentityConflict();
        }
        throw error;
      }
    },
    async listHealth() {
      const rows = await prisma.microsoftAccountConnection.findMany({
        orderBy: { connectedAt: "desc" },
        select: {
          userId: true,
          displayName: true,
          microsoftEmail: true,
          status: true,
          taskSyncEnabled: true,
          calendarSyncEnabled: true,
          lastError: true,
          lastTokenRefreshAt: true,
          connectedAt: true,
          user: { select: { email: true } },
        },
      });
      return rows.map((row) => ({
        userId: row.userId,
        userEmail: row.user.email,
        displayName: row.displayName,
        microsoftEmail: row.microsoftEmail,
        status: row.status,
        taskSyncEnabled: row.taskSyncEnabled,
        calendarSyncEnabled: row.calendarSyncEnabled,
        lastError: row.lastError,
        lastTokenRefreshAt: row.lastTokenRefreshAt,
        connectedAt: row.connectedAt,
      }));
    },
    async appendEvent(event) {
      await prisma.microsoftSyncEvent.create({
        data: {
          id: event.id,
          userId: event.userId,
          connectionId: event.connectionId,
          kind: event.kind,
          message: event.message,
          createdAt: event.createdAt,
        },
      });
    },
  };
}
