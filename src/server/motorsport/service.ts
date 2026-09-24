import { ZodError } from "zod";
import { prisma } from "@/infra/database/client";
import { recordAuditEvent } from "@/server/audit/record";
import { AuthError } from "@/server/rbac/guards";
import {
  MOTORSPORT_PARTNERSHIP_LEAD_SOURCE,
  formatMotorsportLeadNotes,
  motorsportPartnershipEnquirySchema,
} from "@/domain/motorsport";

export type MotorsportEnquiryResult =
  | { ok: true; leadId: string; duplicate?: boolean }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Store a motorsport partnership enquiry as a Lead.
 *
 * Decision: reuse existing Lead (companyName, contactName, email, phone, notes, source)
 * with source = MOTORSPORT_PARTNERSHIP. Structured fields land in notes.
 * No Opportunity, no owner assignment, no CRM expansion in this phase.
 */
export async function submitMotorsportPartnershipEnquiry(
  raw: unknown,
  meta?: { ip?: string | null },
): Promise<MotorsportEnquiryResult> {
  let input;
  try {
    input = motorsportPartnershipEnquirySchema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      return {
        ok: false,
        error: "Please check the highlighted fields.",
        fieldErrors,
      };
    }
    return { ok: false, error: "Invalid enquiry." };
  }

  if (input.websiteConfirm) {
    throw new AuthError("Rejected", "ABUSE", 400);
  }

  const email = input.email.toLowerCase();

  // Soft duplicate guard — same company+email within 10 minutes.
  const recent = await prisma.lead.findFirst({
    where: {
      source: MOTORSPORT_PARTNERSHIP_LEAD_SOURCE,
      companyName: input.companyName,
      email,
      createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) {
    return { ok: true, leadId: recent.id, duplicate: true };
  }

  const notes = formatMotorsportLeadNotes({
    interestedIn: input.interestedIn,
    ...(input.approximateBudget ? { approximateBudget: input.approximateBudget } : {}),
    ...(input.industry ? { industry: input.industry } : {}),
    message: input.message,
  });

  const lead = await prisma.lead.create({
    data: {
      companyName: input.companyName,
      contactName: input.contactName,
      email,
      phone: input.telephone?.trim() || null,
      source: MOTORSPORT_PARTNERSHIP_LEAD_SOURCE,
      status: "NEW",
      notes,
    },
  });

  await recordAuditEvent({
    action: "motorsport.partnership_enquiry",
    entityType: "Lead",
    entityId: lead.id,
    metadata: {
      source: MOTORSPORT_PARTNERSHIP_LEAD_SOURCE,
      interestedIn: input.interestedIn,
      ip: meta?.ip ?? null,
    },
  });

  try {
    const { sendMotorsportEnquiryInternalEmails } = await import("@/server/email/transactional");
    await sendMotorsportEnquiryInternalEmails(lead.id);
  } catch {
    /* email secondary */
  }

  return { ok: true, leadId: lead.id };
}
