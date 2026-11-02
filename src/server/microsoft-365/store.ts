/**
 * Persistence port for Microsoft 365 connections.
 * Implementations must never return refresh tokens to browsers.
 */
export type MicrosoftConnectionStatus = "CONNECTED" | "REVOKED" | "ERROR";

export type StoredOAuthTransaction = {
  id: string;
  userId: string;
  stateHash: string;
  codeVerifierEncrypted: string;
  nonce: string;
  includeCalendar: boolean;
  redirectUri: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type StoredConnection = {
  id: string;
  userId: string;
  status: MicrosoftConnectionStatus;
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
  todoListId: string | null;
  taskOutboundEnabledAt: Date | null;
  taskInboundEnabledAt: Date | null;
  lastInboundSyncAt: Date | null;
  inboundBaselineAt: Date | null;
  calendarOutboundEnabledAt: Date | null;
  calendarInboundEnabledAt: Date | null;
  lastCalendarInboundSyncAt: Date | null;
  calendarInboundBaselineAt: Date | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
};

export type StoredHealthRow = {
  userId: string;
  userEmail: string;
  displayName: string | null;
  microsoftEmail: string | null;
  status: MicrosoftConnectionStatus;
  taskSyncEnabled: boolean;
  calendarSyncEnabled: boolean;
  lastError: string | null;
  lastTokenRefreshAt: Date | null;
  connectedAt: Date | null;
};

export type StoredSyncEvent = {
  id: string;
  userId: string;
  connectionId: string | null;
  kind: string;
  message: string;
  createdAt: Date;
};

export interface Microsoft365Store {
  insertTransaction(row: StoredOAuthTransaction): Promise<void>;
  consumeTransaction(stateHash: string, now: Date): Promise<StoredOAuthTransaction | null>;
  deleteTransactionsForUser(userId: string): Promise<void>;
  findConnectionByUser(userId: string): Promise<StoredConnection | null>;
  findActiveIdentity(activeIdentityKey: string): Promise<StoredConnection | null>;
  saveConnection(row: StoredConnection): Promise<void>;
  listHealth(): Promise<StoredHealthRow[]>;
  appendEvent(event: StoredSyncEvent): Promise<void>;
}

export class MicrosoftIdentityConflict extends Error {
  constructor() {
    super("Microsoft account is already connected to another user");
    this.name = "MicrosoftIdentityConflict";
  }
}
