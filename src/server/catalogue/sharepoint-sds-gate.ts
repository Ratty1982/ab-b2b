import { AuthError } from "@/server/rbac/guards";
import { isSharePointSdsWorkflowEnabled } from "@/domain/sharepoint-sds-enabled";

export function assertSharePointSdsWorkflowEnabled() {
  if (!isSharePointSdsWorkflowEnabled()) {
    throw new AuthError(
      "SharePoint SDS import is disabled. Use Bulk SDS Upload.",
      "DISABLED",
      403,
    );
  }
}
