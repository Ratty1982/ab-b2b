import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthError } from "@/server/rbac/guards";
import {
  clearCertificatePdfObject,
  cleanupDeletedCertificationPdf,
  replaceCertificatePdfObject,
  validateCertificatePdfUpload,
  type CertificatePdfStorageDeps,
} from "@/server/certifications/pdf-storage";

const PDF = Buffer.from("%PDF-1.7\n%cert");

function fakeDeps(options?: {
  putFail?: boolean;
  deleteFailKeys?: string[];
}): CertificatePdfStorageDeps & {
  puts: string[];
  deletes: string[];
  logs: Array<{ message: string; detail?: Record<string, unknown> }>;
} {
  const puts: string[] = [];
  const deletes: string[] = [];
  const logs: Array<{ message: string; detail?: Record<string, unknown> }> = [];
  const deleteFail = new Set(options?.deleteFailKeys ?? []);
  return {
    puts,
    deletes,
    logs,
    async put({ storageKey }) {
      if (options?.putFail) throw new Error("put failed");
      puts.push(storageKey);
      return {
        provider: "s3",
        storageKey,
        bytes: null,
      };
    },
    async delete({ storageKey }) {
      deletes.push(storageKey);
      if (deleteFail.has(storageKey)) throw new Error(`delete failed:${storageKey}`);
    },
    log(message, detail) {
      if (detail) logs.push({ message, detail });
      else logs.push({ message });
    },
  };
}

function prismaStub(options: {
  updateManyCount: number | (() => number);
  onUpdateMany?: (args: unknown) => void;
}) {
  return {
    siteCertification: {
      updateMany: vi.fn(async (args: unknown) => {
        options.onUpdateMany?.(args);
        const count =
          typeof options.updateManyCount === "function"
            ? options.updateManyCount()
            : options.updateManyCount;
        return { count };
      }),
    },
  } as never;
}

describe("validateCertificatePdfUpload", () => {
  it("rejects non-PDF content and oversized payloads", () => {
    expect(() =>
      validateCertificatePdfUpload({ bytes: Buffer.from("not-pdf"), contentType: "application/pdf" }),
    ).toThrow(/must be a PDF/);
    expect(() =>
      validateCertificatePdfUpload({
        bytes: PDF,
        contentType: "image/png",
      }),
    ).toThrow(/must be a PDF/);
    expect(() =>
      validateCertificatePdfUpload({
        bytes: Buffer.alloc(0),
        contentType: "application/pdf",
      }),
    ).toThrow(/between 1 byte and 20 MB/);
  });

  it("accepts valid PDF magic bytes", () => {
    expect(() =>
      validateCertificatePdfUpload({ bytes: PDF, contentType: "application/pdf" }),
    ).not.toThrow();
  });
});

describe("replaceCertificatePdfObject", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads first, commits the DB pointer, then deletes the previous object", async () => {
    const deps = fakeDeps();
    const order: string[] = [];
    const prisma = prismaStub({
      updateManyCount: 1,
      onUpdateMany: () => {
        order.push("db");
        expect(deps.puts).toEqual(["certifications/c1/new.pdf"]);
        expect(deps.deletes).toEqual([]);
      },
    });

    const originalPut = deps.put.bind(deps);
    deps.put = async (opts) => {
      order.push("put");
      return originalPut(opts);
    };
    const originalDelete = deps.delete.bind(deps);
    deps.delete = async (opts) => {
      order.push("delete");
      return originalDelete(opts);
    };

    await replaceCertificatePdfObject({
      prisma,
      deps,
      certificationId: "c1",
      existing: {
        id: "c1",
        certificatePdfStorageKey: "certifications/c1/old.pdf",
        certificatePdfStorageProvider: "s3",
      },
      filename: "certificate.pdf",
      bytes: PDF,
      storageKey: "certifications/c1/new.pdf",
      actorUserId: "admin-1",
    });

    expect(order).toEqual(["put", "db", "delete"]);
    expect(deps.deletes).toEqual(["certifications/c1/old.pdf"]);
  });

  it("retains the original and cleans up the orphan when the database update fails", async () => {
    const deps = fakeDeps();
    const prisma = prismaStub({
      updateManyCount: () => {
        throw new Error("db down");
      },
    });

    await expect(
      replaceCertificatePdfObject({
        prisma,
        deps,
        certificationId: "c1",
        existing: {
          id: "c1",
          certificatePdfStorageKey: "certifications/c1/old.pdf",
          certificatePdfStorageProvider: "s3",
        },
        filename: "certificate.pdf",
        bytes: PDF,
        storageKey: "certifications/c1/orphan.pdf",
        actorUserId: "admin-1",
      }),
    ).rejects.toThrow(/db down/);

    expect(deps.deletes).toEqual(["certifications/c1/orphan.pdf"]);
    expect(deps.deletes).not.toContain("certifications/c1/old.pdf");
    expect(deps.logs.some((entry) => entry.message.includes("failed commit"))).toBe(false);
  });

  it("handles concurrent replacements without deleting the winner's object", async () => {
    const deps = fakeDeps();
    const prisma = prismaStub({ updateManyCount: 0 });

    await expect(
      replaceCertificatePdfObject({
        prisma,
        deps,
        certificationId: "c1",
        existing: {
          id: "c1",
          certificatePdfStorageKey: "certifications/c1/old.pdf",
          certificatePdfStorageProvider: "s3",
        },
        filename: "certificate.pdf",
        bytes: PDF,
        storageKey: "certifications/c1/losing.pdf",
        actorUserId: "admin-1",
      }),
    ).rejects.toBeInstanceOf(AuthError);

    expect(deps.deletes).toEqual(["certifications/c1/losing.pdf"]);
    expect(deps.deletes).not.toContain("certifications/c1/old.pdf");
  });

  it("logs recoverable cleanup failures after a successful commit", async () => {
    const deps = fakeDeps({ deleteFailKeys: ["certifications/c1/old.pdf"] });
    const prisma = prismaStub({ updateManyCount: 1 });

    await replaceCertificatePdfObject({
      prisma,
      deps,
      certificationId: "c1",
      existing: {
        id: "c1",
        certificatePdfStorageKey: "certifications/c1/old.pdf",
        certificatePdfStorageProvider: "s3",
      },
      filename: "certificate.pdf",
      bytes: PDF,
      storageKey: "certifications/c1/new.pdf",
      actorUserId: "admin-1",
    });

    expect(deps.logs.some((entry) => entry.message.includes("previous certificate PDF"))).toBe(
      true,
    );
  });
});

describe("clearCertificatePdfObject / cleanupDeletedCertificationPdf", () => {
  it("clears the DB reference before deleting storage", async () => {
    const deps = fakeDeps();
    const order: string[] = [];
    const prisma = prismaStub({
      updateManyCount: 1,
      onUpdateMany: () => {
        order.push("db");
        expect(deps.deletes).toEqual([]);
      },
    });
    const originalDelete = deps.delete.bind(deps);
    deps.delete = async (opts) => {
      order.push("delete");
      return originalDelete(opts);
    };

    await clearCertificatePdfObject({
      prisma,
      deps,
      certificationId: "c1",
      existing: {
        id: "c1",
        certificatePdfStorageKey: "certifications/c1/old.pdf",
        certificatePdfStorageProvider: "s3",
      },
      actorUserId: "admin-1",
    });

    expect(order).toEqual(["db", "delete"]);
  });

  it("logs storage deletion failures after the row is already gone", async () => {
    const deps = fakeDeps({ deleteFailKeys: ["certifications/c1/old.pdf"] });
    await cleanupDeletedCertificationPdf(deps, {
      id: "c1",
      certificatePdfStorageKey: "certifications/c1/old.pdf",
      certificatePdfStorageProvider: "s3",
    });
    expect(deps.logs[0]?.message).toMatch(/previous certificate PDF/);
  });
});
