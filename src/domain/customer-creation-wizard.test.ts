import { describe, expect, it } from "vitest";
import {
  canContinuePastSalesHistory,
  classifyCustomerDuplicate,
  mergeCustomerTypeNotes,
  normalisePhone,
  salesHistoryBaselineRequired,
  splitCustomerTypeNotes,
  suggestWizardStep,
  wizardFinishPlan,
} from "@/domain/customer-creation-wizard";

describe("customer creation wizard", () => {
  it("treats an exact name, email, or phone as a strong duplicate and a partial name as possible", () => {
    expect(
      classifyCustomerDuplicate(
        { name: "Worsbro Motor Spares Ltd" },
        { name: "WORSBRO MOTOR SPARES LTD", tradingName: null, primaryEmail: null, phone: null },
      ),
    ).toEqual({ strength: "strong", reason: "name" });
    expect(
      classifyCustomerDuplicate(
        { name: "New Garage", email: "parts@example.invalid" },
        { name: "Other Ltd", primaryEmail: "PARTS@example.invalid", phone: null },
      )?.reason,
    ).toBe("email");
    expect(
      classifyCustomerDuplicate(
        { name: "New Garage", phone: "0114 123 4567" },
        { name: "Elsewhere", phone: "0114 1234567", primaryEmail: null },
      )?.reason,
    ).toBe("phone");
    expect(
      classifyCustomerDuplicate(
        { name: "Worsbro" },
        { name: "Worsbro Motor Spares Ltd", primaryEmail: null, phone: null },
      ),
    ).toEqual({ strength: "possible", reason: "similar_name" });
  });

  it("matches formatted UK phone numbers across spaces, +44, 0044, and national 0", () => {
    expect(normalisePhone("0114 123 4567")).toBe("01141234567");
    expect(normalisePhone("+44 114 123 4567")).toBe("01141234567");
    expect(normalisePhone("0044 114 123 4567")).toBe("01141234567");
    expect(normalisePhone("+44 (0) 114 123 4567")).toBe("01141234567");
    expect(normalisePhone("(0114) 123-4567")).toBe("01141234567");
    expect(
      classifyCustomerDuplicate(
        { name: "Alpha Garage", phone: "+44 114 123 4567" },
        { name: "Beta Ltd", phone: "0114 123 4567", primaryEmail: null },
      ),
    ).toEqual({ strength: "strong", reason: "phone" });
    expect(
      classifyCustomerDuplicate(
        { name: "Alpha Garage", phone: "00441141234567" },
        { name: "Beta Ltd", phone: "+44 (0)114 123 4567", primaryEmail: null },
      )?.reason,
    ).toBe("phone");
  });

  it("keeps the customer type in notes without dropping the rest of the note", () => {
    const notes = mergeCustomerTypeNotes("Call before delivery.", "Motor Factor");
    expect(splitCustomerTypeNotes(notes)).toEqual({
      customerType: "Motor Factor",
      notes: "Call before delivery.",
    });
    expect(mergeCustomerTypeNotes(notes, "Bodyshop")).toBe(
      "Customer type: Bodyshop\nCall before delivery.",
    );
  });

  it("does not create a second Customer type line when notes are merged again", () => {
    const once = mergeCustomerTypeNotes(
      "Keep this note.\nCustomer type: Motor Factor",
      "Motor Factor",
    );
    expect(once).toBe("Customer type: Motor Factor\nKeep this note.");
    const twice = mergeCustomerTypeNotes(once, "Motor Factor");
    expect(twice).toBe("Customer type: Motor Factor\nKeep this note.");
    expect(twice?.match(/Customer type:/g)).toHaveLength(1);
    const cleared = mergeCustomerTypeNotes(
      "Customer type: Bodyshop\nCustomer type: Motor Factor\nStaff note",
      "Retailer",
    );
    expect(cleared).toBe("Customer type: Retailer\nStaff note");
  });

  it("returns staff to the unfinished part and does not treat an active account as finished setup", () => {
    expect(
      suggestWizardStep({
        contactCount: 0,
        addressCount: 0,
        salesCode: null,
        salesCodeVerified: false,
        historyStatus: "NOT_STARTED",
        status: "PROSPECT",
      }),
    ).toBe(1);
    expect(
      suggestWizardStep({
        contactCount: 1,
        addressCount: 1,
        salesCode: "WORSBRO",
        salesCodeVerified: false,
        historyStatus: "NOT_STARTED",
        status: "ACTIVE",
      }),
    ).toBe(2);
    expect(
      suggestWizardStep({
        contactCount: 1,
        addressCount: 1,
        salesCode: "WORSBRO",
        salesCodeVerified: true,
        historyStatus: "NOT_STARTED",
        status: "ACTIVE",
      }),
    ).toBe(4);
  });

  it("finishes by opening the customer and does not plan any writes", () => {
    expect(wizardFinishPlan("ckcompany000000000000000")).toEqual({
      companyId: "ckcompany000000000000000",
      mutations: [],
      activatesCustomer: false,
      verifiesSalesAccount: false,
      completesHistory: false,
      sendsInvitation: false,
      createsTransactions: false,
    });
  });

  it("requires an explicit sales history baseline for active verified customers", () => {
    expect(
      salesHistoryBaselineRequired({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "NOT_STARTED",
      }),
    ).toBe(true);
    expect(
      canContinuePastSalesHistory({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "NOT_STARTED",
      }).ok,
    ).toBe(false);
    expect(
      canContinuePastSalesHistory({
        status: "ACTIVE",
        salesCodeVerified: true,
        historyStatus: "COMPLETE",
      }),
    ).toEqual({ ok: true });
    expect(
      salesHistoryBaselineRequired({
        status: "PROSPECT",
        salesCodeVerified: true,
        historyStatus: "NOT_STARTED",
      }),
    ).toBe(false);
    expect(
      salesHistoryBaselineRequired({
        status: "ACTIVE",
        salesCodeVerified: false,
        historyStatus: "NOT_STARTED",
      }),
    ).toBe(false);
  });
});
