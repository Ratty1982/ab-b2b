/**
 * Server-only environment validation.
 * Private secrets must never use the VITE_ prefix (those are bundled to the client).
 */
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:43127"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://ab:ab@localhost:5432/automotive_brands?schema=public"),
  AUTH_SECRET: z.string().min(32).default("dev-only-change-me-to-a-long-random-string!!"),

  // Optional / future
  REDIS_URL: z.string().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY: z.string().optional(),
  OBJECT_STORAGE_SECRET_KEY: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().optional(),
  EMAIL_PROVIDER: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  DEV_SEED_PASSWORD: z.string().optional(),
  ALLOW_PRODUCTION_SEED: z.string().optional(),
  AUTOPART_BASE_URL: z.string().optional(),
  AUTOPART_API_KEY: z.string().optional(),
  AUTOPART_COMPANY_CODE: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/**
 * Parse and cache server env. Call only from server code.
 * In development, defaults keep `vite dev` working before `.env` exists.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("[ab:env] Invalid environment", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid server environment configuration");
  }

  cached = parsed.data;

  if (cached.NODE_ENV === "production" && cached.AUTH_SECRET.startsWith("dev-only-change-me")) {
    throw new Error("AUTH_SECRET must be set to a strong secret in production");
  }

  return cached;
}
