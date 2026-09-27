import { describe, expect, it } from "vitest";
import {
  CALLBACK_REQUEST_LEAD_SOURCE,
  callbackEnquirySchema,
  callbackSupportingCopy,
  formatCallbackActivityBody,
} from "@/domain/callback";

describe("callbackEnquirySchema", () => {
  it("requires name and message, and email or telephone", () => {
    const okEmail = callbackEnquirySchema.safeParse({
      name: "Wayne Radford",
      email: "wayne@example.com",
      message: "Please call me",
    });
    expect(okEmail.success).toBe(true);

    const okPhone = callbackEnquirySchema.safeParse({
      name: "Wayne Radford",
      telephone: "07000000000",
      message: "Please call me",
    });
    expect(okPhone.success).toBe(true);

    const missingContact = callbackEnquirySchema.safeParse({
      name: "Wayne",
      message: "Hi",
    });
    expect(missingContact.success).toBe(false);

    const badEmail = callbackEnquirySchema.safeParse({
      name: "Wayne",
      email: "not-an-email",
      message: "Hi",
    });
    expect(badEmail.success).toBe(false);

    const emptyMessage = callbackEnquirySchema.safeParse({
      name: "Wayne",
      email: "wayne@example.com",
      message: "   ",
    });
    expect(emptyMessage.success).toBe(false);
  });

  it("trims fields and lowercases email", () => {
    const parsed = callbackEnquirySchema.parse({
      name: "  Wayne Radford  ",
      company: "  testy  ",
      email: "  Wayne@Example.COM  ",
      telephone: "  07000  ",
      message: "  Help please  ",
      websiteConfirm: "",
    });
    expect(parsed.name).toBe("Wayne Radford");
    expect(parsed.company).toBe("testy");
    expect(parsed.email).toBe("wayne@example.com");
    expect(parsed.telephone).toBe("07000");
    expect(parsed.message).toBe("Help please");
  });

  it("rejects oversized fields", () => {
    const huge = "x".repeat(5000);
    const result = callbackEnquirySchema.safeParse({
      name: "Wayne",
      email: "wayne@example.com",
      message: huge,
    });
    expect(result.success).toBe(false);
  });
});

describe("callback copy helpers", () => {
  it("uses account manager name when present", () => {
    expect(callbackSupportingCopy("Luke Andrews")).toContain("Luke Andrews");
    expect(callbackSupportingCopy(null)).toContain("trade team");
  });

  it("formats activity body without HTML", () => {
    const body = formatCallbackActivityBody({
      name: "Wayne <script>",
      email: "w@example.com",
      telephone: "07000",
      companyName: "testy",
      accountManagerName: "Luke Andrews",
      message: "<img onerror=alert(1)>",
      accountKind: "trade_customer",
    });
    expect(body).toContain("Wayne <script>");
    expect(body).toContain("Assigned to: Luke Andrews");
    expect(body).toContain("Existing trade customer");
    expect(CALLBACK_REQUEST_LEAD_SOURCE).toBe("CALLBACK_REQUEST");
  });
});
