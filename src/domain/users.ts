import { z } from "zod";
import { SYSTEM_ROLE_KEYS } from "@/domain/permissions";
import { SYSTEM_ROLE_META } from "@/domain/role-permissions";

export const STAFF_USER_STATUSES = ["ACTIVE", "INVITED", "DISABLED"] as const;
export type StaffUserStatus = (typeof STAFF_USER_STATUSES)[number];

export const STAFF_ROLE_OPTIONS = SYSTEM_ROLE_KEYS.map((key) => ({
  key,
  label: SYSTEM_ROLE_META[key].name,
  description: SYSTEM_ROLE_META[key].description,
}));

export const internalUserCreateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(120),
  email: z.string().trim().email("Enter a valid email").max(320),
  role: z.enum(SYSTEM_ROLE_KEYS),
  password: z
    .string()
    .max(128)
    .optional()
    .refine((value) => value === undefined || value === "" || value.length >= 10, {
      message: "Password must be at least 10 characters, or leave it blank to generate one",
    }),
});

export const internalUserUpdateSchema = z.object({
  id: z.string().cuid(),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(SYSTEM_ROLE_KEYS).optional(),
  status: z.enum(STAFF_USER_STATUSES).optional(),
});
