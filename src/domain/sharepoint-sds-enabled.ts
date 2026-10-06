/**
 * SharePoint SDS import is implemented but not the supported production workflow.
 *
 * SHAREPOINT_SDS_ENABLED=true is required to expose scan/import actions.
 * Unset, empty, or any other value keeps the workflow disabled. Stored
 * SharePoint settings and history are left untouched.
 */
export function isSharePointSdsWorkflowEnabled(
  env: NodeJS.Dict<string> | NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(env["SHAREPOINT_SDS_ENABLED"] ?? "")
    .trim()
    .toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}
