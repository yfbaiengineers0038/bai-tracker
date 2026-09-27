import { fetchAuthSession } from "aws-amplify/auth";

/**
 * Which Cognito groups the signed-in user belongs to.
 *
 * Access is granted per project: each project names a group in its
 * `accessGroup`, and a user sees the projects whose group they're in. `admins`
 * sees everything.
 *
 * AppSync enforces this — it filters every query by the groups in the caller's
 * token, so a member physically cannot fetch a project they don't belong to.
 * What's here only drives the UI, so we don't offer buttons the API would
 * reject.
 *
 * Mirrors `UserSession` in the iOS app; keep the two in step.
 */
export const ADMIN_GROUP = "admins";

export interface UserAccess {
  groups: string[];
  /** Bai Engineering staff: every project, every point. */
  isAdmin: boolean;
}

export const NO_ACCESS: UserAccess = { groups: [], isAdmin: false };

export async function loadUserAccess(): Promise<UserAccess> {
  const session = await fetchAuthSession();
  const claim = session.tokens?.accessToken?.payload["cognito:groups"];
  const groups = Array.isArray(claim)
    ? claim.filter((group): group is string => typeof group === "string")
    : [];
  return { groups, isAdmin: groups.includes(ADMIN_GROUP) };
}

/** True when the user may see a project carrying `accessGroup`. */
export function canAccess(access: UserAccess, accessGroup: string | null): boolean {
  if (access.isAdmin) return true;
  return accessGroup !== null && access.groups.includes(accessGroup);
}
