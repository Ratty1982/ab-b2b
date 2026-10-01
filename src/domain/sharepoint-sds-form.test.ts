import { describe, expect, it } from "vitest";
import {
  buildSharePointSdsSavePayload,
  clientSecretFieldPlaceholder,
  emptySharePointSdsFormDraft,
  formDraftFromSettings,
  retainFormDraftAcrossStatusRefresh,
  updateFormDraftField,
} from "@/domain/sharepoint-sds-form";

const baseSettings = {
  sourceLabel: "Power Maxed SDS",
  folderDisplayName: "Power Maxed SDS 2025",
  tenantId: null as string | null,
  clientId: null as string | null,
  userPrincipalName: null as string | null,
  folderUrlHint: null as string | null,
  hasClientSecret: false,
};

describe("SharePoint SDS form draft", () => {
  it("accepts typing into tenant ID", () => {
    let draft = emptySharePointSdsFormDraft();
    draft = updateFormDraftField(draft, "tenantId", "1");
    draft = updateFormDraftField(draft, "tenantId", "12");
    draft = updateFormDraftField(draft, "tenantId", "123");
    expect(draft.tenantId).toBe("123");
  });

  it("accepts pasted tenant / client / UPN / folder URL values", () => {
    let draft = emptySharePointSdsFormDraft();
    draft = updateFormDraftField(
      draft,
      "tenantId",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    draft = updateFormDraftField(
      draft,
      "clientId",
      "11111111-2222-3333-4444-555555555555",
    );
    draft = updateFormDraftField(
      draft,
      "userPrincipalName",
      "george.parker@automotivebrands.co.uk",
    );
    draft = updateFormDraftField(
      draft,
      "folderUrlHint",
      "https://automotivebrands-my.sharepoint.com/personal/george_parker_automotivebrands_co_uk/Documents/SDS",
    );
    expect(draft.tenantId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(draft.clientId).toBe("11111111-2222-3333-4444-555555555555");
    expect(draft.userPrincipalName).toBe("george.parker@automotivebrands.co.uk");
    expect(draft.folderUrlHint).toContain("/Documents/SDS");
  });

  it("does not reset form values during a status-only refresh", () => {
    let draft = formDraftFromSettings(baseSettings);
    draft = updateFormDraftField(draft, "tenantId", "123");
    draft = updateFormDraftField(draft, "clientId", "client-xyz");
    draft = updateFormDraftField(draft, "clientSecret", "temporary-secret");
    draft = updateFormDraftField(draft, "sourceLabel", "Edited label");

    const afterStatus = retainFormDraftAcrossStatusRefresh(draft, {
      ...baseSettings,
      tenantId: null,
      hasClientSecret: true,
      folderDisplayName: "Server folder name",
    });

    expect(afterStatus.tenantId).toBe("123");
    expect(afterStatus.clientId).toBe("client-xyz");
    expect(afterStatus.clientSecret).toBe("temporary-secret");
    expect(afterStatus.sourceLabel).toBe("Edited label");
  });

  it("hydrates saved non-secret fields and never copies a secret", () => {
    const draft = formDraftFromSettings({
      ...baseSettings,
      tenantId: "tenant-saved",
      clientId: "client-saved",
      userPrincipalName: "george.parker@automotivebrands.co.uk",
      folderUrlHint: "https://example.invalid/folder",
      hasClientSecret: true,
    });
    expect(draft.tenantId).toBe("tenant-saved");
    expect(draft.clientId).toBe("client-saved");
    expect(draft.userPrincipalName).toBe("george.parker@automotivebrands.co.uk");
    expect(draft.folderUrlHint).toBe("https://example.invalid/folder");
    expect(draft.clientSecret).toBe("");
  });

  it("omits blank secret from save payload so existing secret is preserved", () => {
    const draft = updateFormDraftField(
      formDraftFromSettings({
        ...baseSettings,
        tenantId: "t1",
        clientId: "c1",
        hasClientSecret: true,
      }),
      "clientSecret",
      "   ",
    );
    const payload = buildSharePointSdsSavePayload(draft);
    expect(payload).not.toHaveProperty("clientSecret");
    expect(payload.tenantId).toBe("t1");
    expect(payload.clientId).toBe("c1");
  });

  it("includes a new secret when provided", () => {
    const draft = updateFormDraftField(
      emptySharePointSdsFormDraft(),
      "clientSecret",
      "new-secret-value",
    );
    const payload = buildSharePointSdsSavePayload(draft);
    expect(payload.clientSecret).toBe("new-secret-value");
  });

  it("shows a safe secret-configured placeholder", () => {
    expect(clientSecretFieldPlaceholder(true)).toMatch(/Secret configured/i);
    expect(clientSecretFieldPlaceholder(false)).toMatch(/Paste secret/i);
  });
});
