import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SETTINGS_TABS,
  parseSettingsSearch,
  type SettingsTab,
} from "@/domain/admin-settings-tabs";

const root = process.cwd();
const src = readFileSync(join(root, "src/routes/admin.settings.tsx"), "utf8");

describe("parseSettingsSearch", () => {
  it("defaults missing/invalid tab to general", () => {
    expect(parseSettingsSearch({})).toEqual({ tab: "general" });
    expect(parseSettingsSearch({ tab: "" })).toEqual({ tab: "general" });
    expect(parseSettingsSearch({ tab: "nope" })).toEqual({ tab: "general" });
    expect(parseSettingsSearch({ tab: 1 as unknown as string })).toEqual({ tab: "general" });
  });

  it("accepts every canonical tab id (case-insensitive)", () => {
    for (const tab of SETTINGS_TABS) {
      expect(parseSettingsSearch({ tab })).toEqual({ tab });
      expect(parseSettingsSearch({ tab: tab.toUpperCase() })).toEqual({ tab });
    }
  });
});

describe("resolveSettingsTab", () => {
  it("treats absent tab as general", async () => {
    const { resolveSettingsTab } = await import("@/domain/admin-settings-tabs");
    expect(resolveSettingsTab({})).toBe("general");
    expect(resolveSettingsTab({ tab: "email" })).toBe("email");
  });
});

describe("admin settings workspace structure", () => {
  it("wires validateSearch to shared parser and lists all tabs", () => {
    expect(src).toContain("validateSearch:");
    expect(src).toContain("parseSettingsSearch");
    for (const tab of [
      "general",
      "trade",
      "email",
      "autopart",
      "documents",
      "system",
    ] satisfies SettingsTab[]) {
      expect(src).toContain(`"${tab}"`);
    }
    expect(src).toContain("data-settings-tab=");
  });

  it("conditionally mounts only the active tab panel (not CSS-hide-all)", () => {
    expect(src).toMatch(/tab === "general" \? <GeneralTab/);
    expect(src).toMatch(/tab === "trade" \? <TradeTab/);
    expect(src).toMatch(/tab === "email" \? <EmailTab/);
    expect(src).toMatch(/tab === "autopart" \? <AutopartTab/);
    expect(src).toMatch(/tab === "documents" \? <DocumentsTab/);
    expect(src).toMatch(/tab === "system" \? <SystemTab/);
    expect(src).not.toMatch(/hidden=\{tab !==/);
  });

  it("places panels in the intended tabs", () => {
    expect(src).toMatch(/function GeneralTab[\s\S]*PlatformDefaultsSection/);
    expect(src).toMatch(/function TradeTab[\s\S]*TradeTestingPanel[\s\S]*TradeOrderingSettingsPanel/);
    expect(src).toMatch(/function EmailTab[\s\S]*EmailSettingsPanel/);
    expect(src).toMatch(
      /function AutopartTab[\s\S]*Autopart504cFeedPanel[\s\S]*AutopartOngoingSalesFeedPanel/,
    );
    expect(src).toMatch(/function DocumentsTab[\s\S]*SDS management/);
    expect(src).toMatch(/function DocumentsTab[\s\S]*Bulk SDS Upload/);
    expect(src).toMatch(/function DocumentsTab[\s\S]*sharePointEnabled \?/);
    expect(src).toMatch(/function DocumentsTab[\s\S]*SharePointSdsSettingsPanel/);
    expect(src).toMatch(/function SystemTab[\s\S]*No editable system settings/);
  });

  it("keeps trade testing labelled as an internal tool", () => {
    expect(src).toMatch(/Trade testing/i);
    expect(src).toMatch(/Internal tool/);
  });

  it("uses accessible tab semantics and scrollable nav", () => {
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain("aria-selected");
    expect(src).toContain("overflow-x-auto");
  });

  it("preserves read-only platform defaults values", () => {
    expect(src).toMatch(/Read-only platform rules/i);
    expect(src).toContain("£100.00");
    expect(src).toContain("£5.95");
    expect(src).toContain("30 Days Net");
    expect(src).toContain("Default Trade Price");
  });
});

describe("504/TRM fulfilment settings surfaces", () => {
  it("wires the fulfilment switch and retired 504C copy", () => {
    const ongoing = readFileSync(join(root, "src/components/ab/AutopartOngoingSalesFeedPanel.tsx"), "utf8");
    const c504 = readFileSync(join(root, "src/components/ab/Autopart504cFeedPanel.tsx"), "utf8");
    const order = readFileSync(join(root, "src/routes/admin.orders.$orderId.tsx"), "utf8");
    expect(ongoing).toContain("get504TrmFulfilmentSettingsFn");
    expect(ongoing).toContain("update504TrmFulfilmentSettingsFn");
    expect(ongoing).toContain("preview504TrmFulfilmentFn");
    expect(ongoing).toContain('data-admin-section="autopart-504-trm-fulfilment"');
    expect(ongoing).toContain("OFF");
    expect(ongoing).toContain("PREVIEW");
    expect(ongoing).toContain("ACTIVE");
    expect(c504).toMatch(/Legacy 504C is retired/);
    expect(c504).toContain("runtimeMode === \"RETIRED\"");
    expect(order).toContain("autopartFulfilment");
    expect(order).toContain("Autopart fulfilment");
  });
});

