/**
 * Version Updates / What's New — content shape, audience, plain-text sanitising.
 */
import { SYSTEM_ROLE_KEYS, type SystemRoleKey } from "@/domain/permissions";
import { SYSTEM_ROLE_META } from "@/domain/role-permissions";

export const VERSION_UPDATE_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type VersionUpdateStatusKey = (typeof VERSION_UPDATE_STATUSES)[number];

export type VersionUpdateSection = {
  heading: string;
  body: string;
};

export type VersionUpdateContent = {
  intro: string;
  sections: VersionUpdateSection[];
};

export type VersionUpdateAudience =
  | { mode: "ALL_INTERNAL" }
  | { mode: "ROLES"; roleKeys: SystemRoleKey[] };

export function emptyVersionUpdateContent(): VersionUpdateContent {
  return { intro: "", sections: [{ heading: "", body: "" }] };
}

export function defaultAudience(): VersionUpdateAudience {
  return { mode: "ALL_INTERNAL" };
}

/** Strip tags/control chars — content is structured plain text, not free HTML. */
export function sanitisePlainText(input: string, max = 8000): string {
  return input
    .replace(/\u0000/g, "")
    // Drop script/style blocks (including their text) before stripping other tags.
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

export function parseVersionUpdateContent(raw: unknown): VersionUpdateContent {
  if (!raw || typeof raw !== "object") return emptyVersionUpdateContent();
  const o = raw as Record<string, unknown>;
  const intro = typeof o["intro"] === "string" ? sanitisePlainText(o["intro"], 4000) : "";
  const sectionsRaw = Array.isArray(o["sections"]) ? o["sections"] : [];
  const sections: VersionUpdateSection[] = sectionsRaw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const row = s as Record<string, unknown>;
      const heading = typeof row["heading"] === "string" ? sanitisePlainText(row["heading"], 200) : "";
      const body = typeof row["body"] === "string" ? sanitisePlainText(row["body"], 8000) : "";
      if (!heading && !body) return null;
      return { heading, body };
    })
    .filter((s): s is VersionUpdateSection => Boolean(s));
  return { intro, sections: sections.length ? sections : [] };
}

export function parseVersionUpdateAudience(raw: unknown): VersionUpdateAudience {
  if (!raw || typeof raw !== "object") return defaultAudience();
  const o = raw as Record<string, unknown>;
  if (o["mode"] === "ROLES") {
    const keys = Array.isArray(o["roleKeys"])
      ? o["roleKeys"].filter(
          (k): k is SystemRoleKey =>
            typeof k === "string" && (SYSTEM_ROLE_KEYS as readonly string[]).includes(k),
        )
      : [];
    return { mode: "ROLES", roleKeys: [...new Set(keys)] };
  }
  return { mode: "ALL_INTERNAL" };
}

export function audienceTargetsUser(
  audience: VersionUpdateAudience,
  systemRoles: string[],
): boolean {
  if (audience.mode === "ALL_INTERNAL") return true;
  return audience.roleKeys.some((k) => systemRoles.includes(k));
}

export function audienceLabel(audience: VersionUpdateAudience): string {
  if (audience.mode === "ALL_INTERNAL") return "Internal Staff";
  if (!audience.roleKeys.length) return "No roles selected";
  return audience.roleKeys
    .map((k) => SYSTEM_ROLE_META[k]?.name ?? k)
    .join(", ");
}

export function roleAudienceOptions(): Array<{ key: SystemRoleKey; label: string }> {
  return SYSTEM_ROLE_KEYS.map((key) => ({
    key,
    label: SYSTEM_ROLE_META[key]?.name ?? key,
  }));
}

export function validateVersionLabel(version: string): string | null {
  const v = version.trim();
  if (!v) return "Version is required";
  if (v.length > 40) return "Version is too long";
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/.test(v)) {
    return "Use a short version like 1.4 or 2026.10";
  }
  return null;
}

/** Date-only YYYY-MM-DD → auto version label 2026.10.05 (existing architecture requires version). */
export function quickUpdateVersionFromDate(isoDate: string): string {
  const m = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate.replace(/[^\dA-Za-z._-]/g, ".").slice(0, 40);
  return `${m[1]}.${m[2]}.${m[3]}`;
}

export type QuickPasteParseResult =
  | { ok: false; error: string }
  | {
      ok: true;
      title: string;
      intro: string;
      content: VersionUpdateContent;
      titleOnly: boolean;
    };

const BULLET_LINE = /^\s*(?:[•\u2022\-\*])\s+(.*)$/;

export function normaliseQuickPasteBulletLine(line: string): string {
  const match = line.match(BULLET_LINE);
  if (!match) return line.replace(/[ \t]+$/g, "");
  return `• ${match[1]!.replace(/[ \t]+$/g, "")}`;
}

/**
 * Quick Add paste contract:
 * first non-empty line = title; everything after = body.
 * Bullet markers • - * are normalised to • . HTML/scripts are stripped.
 */
export function parseQuickPasteUpdate(raw: string): QuickPasteParseResult {
  const source = String(raw ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!source.trim()) {
    return { ok: false, error: "Paste an update. The first line is the title." };
  }

  const lines = source.split("\n");
  const firstIdx = lines.findIndex((line) => line.trim().length > 0);
  if (firstIdx < 0) {
    return { ok: false, error: "Paste an update. The first line is the title." };
  }

  const title = sanitisePlainText(lines[firstIdx]!, 200);
  if (!title) {
    return { ok: false, error: "Paste an update. The first line is the title." };
  }

  const rawBody = lines.slice(firstIdx + 1).join("\n");
  const cleanedBody = sanitisePlainText(rawBody, 4000);
  const intro = cleanedBody.split("\n").map(normaliseQuickPasteBulletLine).join("\n").trim();
  return {
    ok: true,
    title,
    intro,
    content: { intro, sections: [] },
    titleOnly: !intro,
  };
}
