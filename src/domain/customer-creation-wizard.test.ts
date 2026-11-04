import { describe, expect, it } from "vitest";
import {
  classifyCustomerDuplicate,
  mergeCustomerTypeNotes,
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
        { name: "New Garage", phone: "0114 123 456" },
        { name: "Elsewhere", phone: "01141 23456", primaryEmail: null },
      )?.reason,
    ).toBe("phone");
    expect(
      classifyCustomerDuplicate(
        { name: "Worsbro" },
        { name: "Worsbro Motor Spares Ltd", primaryEmail: null, phone: null },
      ),
    ).toEqual({ strength: "possible", reason: "similar_name" });
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
});
