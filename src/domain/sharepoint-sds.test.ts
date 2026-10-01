import { describe, expect, it } from "vitest";
import {
  buildSharePointSourceMetadata,
  isPdfFilename,
  parseSharePointFolderUrl,
  publicMicrosoftErrorMessage,
  readSharePointSourceMetadata,
} from "@/domain/sharepoint-sds";

describe("sharepoint SDS domain", () => {
  it("parses personal OneDrive folder browser URL", () => {
    const url =
      "https://autobrands-my.sharepoint.com/personal/george_parker_automotivebrands_co_uk/_layouts/15/onedrive.aspx?id=%2Fpersonal%2Fgeorge%5Fparker%5Fautomotivebrands%5Fco%5Fuk%2FDocuments%2FDesktop%2FGeorge%2FSDS%2FPM%20SDS%2FPower%20Maxed%20SDS%202025&ga=1";
    const parsed = parseSharePointFolderUrl(url);
    expect(parsed.userPrincipalName).toBe("george.parker@automotivebrands.co.uk");
    expect(parsed.folderPath).toContain("Power Maxed SDS 2025");
    expect(parsed.folderPath?.startsWith("Desktop/")).toBe(true);
  });

  it("ignores non-PDF names", () => {
    expect(isPdfFilename("a.pdf")).toBe(true);
    expect(isPdfFilename("a.PDF")).toBe(true);
    expect(isPdfFilename("notes.docx")).toBe(false);
  });

  it("round-trips source metadata without public URL fields", () => {
    const meta = buildSharePointSourceMetadata({
      driveId: "drive1",
      itemId: "item1",
      filename: "PMAPC500 SDS.pdf",
      eTag: '"abc"',
      folderItemId: "folder1",
    });
    expect(meta.source).toBe("SHAREPOINT");
    const read = readSharePointSourceMetadata(meta);
    expect(read?.itemId).toBe("item1");
    expect(JSON.stringify(meta)).not.toMatch(/sharepoint\.com/i);
  });

  it("sanitises Microsoft errors and never echoes bearer tokens", () => {
    const msg = publicMicrosoftErrorMessage(
      new Error("Unauthorized Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx"),
    );
    expect(msg.toLowerCase()).not.toContain("eyj");
    expect(msg).toMatch(/Authentication failed|Permission denied|redacted/i);
    const denied = publicMicrosoftErrorMessage(new Error("AccessDenied 403 Forbidden"));
    expect(denied).toContain("Files.SelectedOperations.Selected");
    expect(denied).not.toContain("Files.Read.All");
  });
});

