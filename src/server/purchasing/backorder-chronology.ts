/**
 * Current 216V position follows report date, not import time.
 * Reading snapshots does not rewrite them.
 */

import { prisma } from "@/infra/database/client";
import { pickCurrent216vSnapshot, type Autopart216vSnapshotChronology } from "@/domain/autopart-216v-report-date";

export type Committed216vSnapshotHeader = Autopart216vSnapshotChronology & {
  id: string;
  filename: string | null;
  businessDate: Date;
  receivedAt: Date | null;
  importedAt: Date;
};

const headerSelect = {
  id: true,
  filename: true,
  businessDate: true,
  receivedAt: true,
  importedAt: true,
} as const;

export async function listCommitted216vSnapshots(): Promise<Committed216vSnapshotHeader[]> {
  return prisma.autopartBackorderSnapshot.findMany({
    where: { status: "COMMITTED" },
    select: headerSelect,
  });
}

export async function currentCommitted216vSnapshot(): Promise<Committed216vSnapshotHeader | null> {
  return pickCurrent216vSnapshot(await listCommitted216vSnapshots());
}
