import { describe, expect, it } from "vitest";
import {
  assertAuthorisedSdsResource,
  assertSafeGraphResourceId,
  isAllowedSharePointFolderUrl,
  isSafeGraphResourceId,
  isValidEntraGuid,
  resolveMicrosoftGraphUrl,
  resolveMicrosoftTokenUrl,
  RECOMMENDED_GRAPH_APPLICATION_PERMISSION,
} from "@/domain/microsoft-graph-security";

describe("microsoft graph security helpers", () => {
  it("recommends Files.SelectedOperations.Selected", () => {
    expect(RECOMMENDED_GRAPH_APPLICATION_PERMISSION).toBe("Files.SelectedOperations.Selected");
  });

  it("rejects unsafe Graph resource ids", () => {
    expect(isSafeGraphResourceId("abc123")).toBe(true);
    expect(isSafeGraphResourceId("../etc")).toBe(false);
    expect(isSafeGraphResourceId("a/b")).toBe(false);
    expect(isSafeGraphResourceId("")).toBe(false);
    expect(() => assertSafeGraphResourceId("..")).toThrow(/Invalid/);
  });

  it("resolves only graph.microsoft.com URLs", () => {
    expect(resolveMicrosoftGraphUrl("/drives/d/items/i")).toBe(
      "https://graph.microsoft.com/v1.0/drives/d/items/i",
    );
    expect(
      resolveMicrosoftGraphUrl(
        "https://graph.microsoft.com/v1.0/drives/d/items/f/children?$skiptoken=1",
      ),
    ).toContain("graph.microsoft.com");
    expect(() => resolveMicrosoftGraphUrl("https://evil.example/x")).toThrow(/not allowed/);
    expect(() => resolveMicrosoftGraphUrl("http://graph.microsoft.com/v1.0/x")).toThrow(/HTTPS/);
  });

  it("builds login.microsoftonline.com token URL only", () => {
    expect(resolveMicrosoftTokenUrl("11111111-2222-3333-4444-555555555555")).toContain(
      "login.microsoftonline.com",
    );
    expect(() => resolveMicrosoftTokenUrl("../tenant")).toThrow();
  });

  it("allowlists SharePoint folder URL hosts", () => {
    expect(
      isAllowedSharePointFolderUrl(
        "https://automotivebrands-my.sharepoint.com/personal/george_parker_automotivebrands_co_uk/Documents/SDS",
      ),
    ).toBe(true);
    expect(isAllowedSharePointFolderUrl("https://evil.example/SDS")).toBe(false);
    expect(isAllowedSharePointFolderUrl("http://contoso.sharepoint.com/x")).toBe(false);
  });

  it("enforces authorised SDS resource allowlist", () => {
    const configured = {
      tenantId: "t",
      driveId: "drive-A",
      folderItemId: "folder-A",
    };
    expect(() =>
      assertAuthorisedSdsResource({
        configured,
        driveId: "drive-A",
        folderItemId: "folder-A",
      }),
    ).not.toThrow();
    expect(() =>
      assertAuthorisedSdsResource({
        configured,
        driveId: "drive-OTHER",
        folderItemId: "folder-A",
      }),
    ).toThrow(/outside the authorised/);
    expect(() =>
      assertAuthorisedSdsResource({
        configured,
        driveId: "drive-A",
        itemParentFolderId: "folder-OTHER",
      }),
    ).toThrow(/outside the authorised/);
  });

  it("validates Entra GUIDs", () => {
    expect(isValidEntraGuid("89ea5c94-7736-4e25-95ad-3fa95f62b66e")).toBe(true);
    expect(isValidEntraGuid("not-a-guid")).toBe(false);
  });
});
