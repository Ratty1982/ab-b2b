/**
 * Safe certificate PDF object replacement.
 * Always commit the DB reference before deleting the previous object.
 * On DB failure, retain the original and clean up the newly uploaded orphan.
 */
import { CERTIFICATION_PDF_MAX_BYTES, isPdfBytes } from "@/domain/certifications";
import { AuthError } from "@/server/rbac/guards";

/** Narrow DB surface used by PDF replacement helpers (avoids coupling tests to full PrismaClient). */
export type CertificatePdfDb = {
  siteCertification: {
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
};

export type CertificatePdfStoredObject = {
  provider: string;
  storageKey: string;
  bytes: Uint8Array | null;
};

export type CertificatePdfStorageDeps = {
  put: (opts: {
    storageKey: string;
    bytes: Buffer;
    contentType: string;
  }) => Promise<CertificatePdfStoredObject>;
  delete: (opts: { storageProvider: string; storageKey: string }) => Promise<void>;
  log: (message: string, detail?: Record<string, unknown>) => void;
};

export type CertificatePdfRowSnapshot = {
  id: string;
  certificatePdfStorageKey: string | null;
  certificatePdfStorageProvider: string | null;
};

export function validateCertificatePdfUpload(input: {
  bytes: Buffer;
  contentType: string;
  maxBytes?: number;
}): void {
  const max = input.maxBytes ?? CERTIFICATION_PDF_MAX_BYTES;
  if (input.bytes.length === 0 || input.bytes.length > max) {
    throw new AuthError("Certificate PDF must be between 1 byte and 20 MB", "VALIDATION", 400);
  }
  if (!isPdfBytes(input.bytes) || !input.contentType.toLowerCase().includes("pdf")) {
    throw new AuthError("Certificate file must be a PDF", "VALIDATION", 400);
  }
}

/**
 * Upload a replacement PDF, commit the DB pointer, then delete the previous object.
 * Concurrent writers are detected via compare-and-swap on the previous storage key.
 */
export async function replaceCertificatePdfObject(input: {
  prisma: CertificatePdfDb;
  deps: CertificatePdfStorageDeps;
  certificationId: string;
  existing: CertificatePdfRowSnapshot;
  filename: string;
  bytes: Buffer;
  storageKey: string;
  actorUserId: string;
}): Promise<{
  committed: true;
  previousKey: string | null;
  previousProvider: string | null;
  stored: CertificatePdfStoredObject;
}> {
  validateCertificatePdfUpload({
    bytes: input.bytes,
    contentType: "application/pdf",
  });

  const previousKey = input.existing.certificatePdfStorageKey;
  const previousProvider = input.existing.certificatePdfStorageProvider || "database";

  const stored = await input.deps.put({
    storageKey: input.storageKey,
    contentType: "application/pdf",
    bytes: input.bytes,
  });

  try {
    const updated = await input.prisma.siteCertification.updateMany({
      where: {
        id: input.certificationId,
        ...(previousKey == null
          ? { certificatePdfStorageKey: null }
          : { certificatePdfStorageKey: previousKey }),
      },
      data: {
        certificatePdfStorageKey: stored.storageKey,
        certificatePdfStorageProvider: stored.provider,
        certificatePdfFilename: input.filename,
        certificatePdfContentType: "application/pdf",
        certificatePdfSizeBytes: input.bytes.length,
        certificatePdfBytes: stored.bytes ? Buffer.from(stored.bytes) : null,
        updatedById: input.actorUserId,
      },
    });

    if (updated.count !== 1) {
      await cleanupOrphan(input.deps, stored, "concurrent certificate PDF replacement rejected");
      throw new AuthError(
        "Certificate PDF was updated by another administrator. Refresh and try again.",
        "CONFLICT",
        409,
      );
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    await cleanupOrphan(input.deps, stored, "database update failed after certificate PDF upload");
    throw error;
  }

  if (previousKey && previousKey !== stored.storageKey) {
    await cleanupPrevious(input.deps, {
      storageProvider: previousProvider,
      storageKey: previousKey,
    });
  }

  return {
    committed: true,
    previousKey,
    previousProvider,
    stored,
  };
}

/**
 * Clear the DB PDF pointer first, then delete the storage object.
 * Never delete storage while the row still references it.
 */
export async function clearCertificatePdfObject(input: {
  prisma: CertificatePdfDb;
  deps: CertificatePdfStorageDeps;
  certificationId: string;
  existing: CertificatePdfRowSnapshot;
  actorUserId: string;
}): Promise<{ cleared: boolean; previousKey: string | null }> {
  const previousKey = input.existing.certificatePdfStorageKey;
  const previousProvider = input.existing.certificatePdfStorageProvider || "database";
  if (!previousKey) {
    return { cleared: false, previousKey: null };
  }

  const updated = await input.prisma.siteCertification.updateMany({
    where: {
      id: input.certificationId,
      certificatePdfStorageKey: previousKey,
    },
    data: {
      certificatePdfStorageKey: null,
      certificatePdfStorageProvider: null,
      certificatePdfFilename: null,
      certificatePdfContentType: null,
      certificatePdfSizeBytes: null,
      certificatePdfBytes: null,
      updatedById: input.actorUserId,
    },
  });

  if (updated.count !== 1) {
    throw new AuthError(
      "Certificate PDF was updated by another administrator. Refresh and try again.",
      "CONFLICT",
      409,
    );
  }

  await cleanupPrevious(input.deps, {
    storageProvider: previousProvider,
    storageKey: previousKey,
  });

  return { cleared: true, previousKey };
}

/**
 * After the certification row is deleted, best-effort remove its PDF object.
 * Callers must delete (or detach) the DB row before invoking this.
 */
export async function cleanupDeletedCertificationPdf(
  deps: CertificatePdfStorageDeps,
  existing: CertificatePdfRowSnapshot,
): Promise<void> {
  if (!existing.certificatePdfStorageKey) return;
  await cleanupPrevious(deps, {
    storageProvider: existing.certificatePdfStorageProvider || "database",
    storageKey: existing.certificatePdfStorageKey,
  });
}

async function cleanupOrphan(
  deps: CertificatePdfStorageDeps,
  stored: CertificatePdfStoredObject,
  reason: string,
): Promise<void> {
  try {
    await deps.delete({
      storageProvider: stored.provider,
      storageKey: stored.storageKey,
    });
  } catch (error) {
    deps.log("failed to clean up orphan certificate PDF after failed commit", {
      reason,
      storageKey: stored.storageKey,
      storageProvider: stored.provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function cleanupPrevious(
  deps: CertificatePdfStorageDeps,
  object: { storageProvider: string; storageKey: string },
): Promise<void> {
  try {
    await deps.delete(object);
  } catch (error) {
    deps.log("failed to delete previous certificate PDF after successful commit", {
      storageKey: object.storageKey,
      storageProvider: object.storageProvider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function defaultCertificatePdfStorageDeps(): CertificatePdfStorageDeps {
  // Lazy import keeps unit tests free to inject fakes without loading S3 helpers.
  return {
    async put(opts) {
      const { putMediaObject } = await import("@/server/cms/storage");
      return putMediaObject(opts);
    },
    async delete(opts) {
      const { deleteMediaObject } = await import("@/server/cms/storage");
      return deleteMediaObject(opts);
    },
    log(message, detail) {
      console.error("[ab:certifications-pdf]", message, detail ?? {});
    },
  };
}
