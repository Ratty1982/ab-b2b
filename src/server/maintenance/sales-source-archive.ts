/**
 * Copies Autopart source reports onto a persistent volume and checks the copy
 * before the imported-sales reset is allowed to delete database rows.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/infra/database/client";
import {
  archivedBytesMatch,
  persistentSalesArchiveProblem,
  salesArchiveDirectory,
} from "@/domain/imported-sales-reset";

type Db = PrismaClient | Prisma.TransactionClient;

export class SalesArchiveError extends Error {}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function persistentDirectory(): string {
  const resolved = path.resolve(salesArchiveDirectory());
  const problem = persistentSalesArchiveProblem(resolved, path.resolve(process.cwd()));
  if (problem) throw new SalesArchiveError(problem);
  return resolved;
}

function writeAndVerify(destination: string, bytes: Buffer, expectedSha256: string) {
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  if (!existsSync(destination)) {
    throw new SalesArchiveError(`Archived file is missing: ${destination}. Imported sales were not deleted.`);
  }
  const stored = readFileSync(destination);
  const actualBytes = statSync(destination).size;
  if (
    !archivedBytesMatch({
      expectedSha256,
      expectedBytes: bytes.length,
      actualSha256: sha256(stored),
      actualBytes,
    })
  ) {
    throw new SalesArchiveError(
      `Archived file ${destination} does not match the source hash or size. Imported sales were not deleted.`,
    );
  }
}

function readRequiredBytes(input: {
  label: string;
  body: Uint8Array | null;
  storagePath: string | null;
  expectedSha256: string;
}): Buffer {
  if (input.storagePath) {
    if (!existsSync(input.storagePath)) {
      throw new SalesArchiveError(
        `${input.label} source file is missing at ${input.storagePath}. Imported sales were not deleted.`,
      );
    }
    const fileBytes = readFileSync(input.storagePath);
    const fileHash = sha256(fileBytes);
    if (fileHash !== input.expectedSha256.toLowerCase() || (input.body && sha256(Buffer.from(input.body)) !== fileHash)) {
      throw new SalesArchiveError(
        `${input.label} source file does not match its recorded SHA-256. Imported sales were not deleted.`,
      );
    }
    return fileBytes;
  }
  if (input.body && input.body.byteLength > 0) {
    const bytes = Buffer.from(input.body);
    if (sha256(bytes) !== input.expectedSha256.toLowerCase()) {
      throw new SalesArchiveError(
        `${input.label} stored bytes do not match the recorded SHA-256. Imported sales were not deleted.`,
      );
    }
    return bytes;
  }
  throw new SalesArchiveError(
    `${input.label} has no source file to archive. Imported sales were not deleted.`,
  );
}

export async function archiveImportedSalesSources(db: Db = prisma): Promise<{ directory: string; files: number }> {
  const root = path.join(persistentDirectory(), new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(root, { recursive: true });
  const manifest: Array<Record<string, string | number | null>> = [];
  let files = 0;

  const history = await db.autopartHistoryAllImport.findMany({
    select: {
      id: true,
      filename561l: true,
      filenameSlrb: true,
      fileHash561l: true,
      fileHashSlrb: true,
      storagePath561l: true,
      storagePathSlrb: true,
      fileBody561l: true,
      fileBodySlrb: true,
    },
  });
  for (const row of history) {
    const folder = path.join(root, "history", row.id);
    const body561 = readRequiredBytes({
      label: `561L ${row.filename561l || row.id}`,
      body: row.fileBody561l,
      storagePath: row.storagePath561l,
      expectedSha256: row.fileHash561l,
    });
    const destination561 = path.join(folder, "561l.bin");
    writeAndVerify(destination561, body561, row.fileHash561l);
    files += 1;
    manifest.push({
      kind: "561L",
      id: row.id,
      filename: row.filename561l,
      sha256: row.fileHash561l.toLowerCase(),
      bytes: body561.length,
      path: destination561,
    });

    const slrbRequired = Boolean(row.fileHashSlrb || row.fileBodySlrb || row.storagePathSlrb || row.filenameSlrb);
    if (slrbRequired) {
      if (!row.fileHashSlrb) {
        throw new SalesArchiveError(
          `SLRB ${row.filenameSlrb || row.id} has no recorded SHA-256. Imported sales were not deleted.`,
        );
      }
      const bodySlrb = readRequiredBytes({
        label: `SLRB ${row.filenameSlrb || row.id}`,
        body: row.fileBodySlrb,
        storagePath: row.storagePathSlrb,
        expectedSha256: row.fileHashSlrb,
      });
      const destinationSlrb = path.join(folder, "slrb.bin");
      writeAndVerify(destinationSlrb, bodySlrb, row.fileHashSlrb);
      files += 1;
      manifest.push({
        kind: "SLRB",
        id: row.id,
        filename: row.filenameSlrb,
        sha256: row.fileHashSlrb.toLowerCase(),
        bytes: bodySlrb.length,
        path: destinationSlrb,
      });
    }
  }

  const batches = await db.autopartImportBatch.findMany({
    where: { kind: { in: ["INVOICE_LINES", "LEDGER"] }, storagePath: { not: null } },
    select: { id: true, kind: true, filename: true, storagePath: true, fileHash: true },
  });
  for (const batch of batches) {
    if (!batch.storagePath) continue;
    const bytes = readRequiredBytes({
      label: `${batch.kind} ${batch.filename}`,
      body: null,
      storagePath: batch.storagePath,
      expectedSha256: batch.fileHash,
    });
    const destination = path.join(root, "batches", `${batch.id}.bin`);
    writeAndVerify(destination, bytes, batch.fileHash);
    files += 1;
    manifest.push({
      kind: batch.kind,
      id: batch.id,
      filename: batch.filename,
      sha256: batch.fileHash.toLowerCase(),
      bytes: bytes.length,
      path: destination,
    });
  }

  const manifestPath = path.join(root, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify({ files, items: manifest }, null, 2));
  const written = JSON.parse(readFileSync(manifestPath, "utf8")) as { files?: number };
  if (written.files !== files) {
    throw new SalesArchiveError("Archive manifest could not be read back. Imported sales were not deleted.");
  }
  return { directory: root, files };
}

/** Best-effort copy of a 504 or TRM21QC report. Never blocks the import. */
export function retainOngoingSalesReport(input: {
  kind: "ONGOING_504" | "TRM21QC";
  filename: string | null;
  text: string;
}): { retained: boolean; path: string | null } {
  try {
    const root = path.join(persistentDirectory(), "ongoing");
    const hash = sha256(Buffer.from(input.text));
    const destination = path.join(root, input.kind, `${hash}.txt`);
    if (!existsSync(destination)) writeAndVerify(destination, Buffer.from(input.text), hash);
    const note = path.join(root, input.kind, `${hash}.json`);
    writeFileSync(
      note,
      JSON.stringify({ kind: input.kind, filename: input.filename, sha256: hash, bytes: Buffer.byteLength(input.text) }),
    );
    return { retained: true, path: destination };
  } catch {
    return { retained: false, path: null };
  }
}
