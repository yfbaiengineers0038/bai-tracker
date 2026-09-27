import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito auth: users sign in with their email address. Accounts are created
 * by an administrator — see the `allowAdminCreateUserOnly` override in
 * `backend.ts`.
 *
 * Access is granted with Cognito groups, one per project:
 *
 *   admins            Bai Engineering staff. Every project, every point.
 *   <project group>   Named on the project's `accessGroup` field. Members get
 *                     that project and its points, and nothing else.
 *
 * Only `admins` is declared here. Project groups are created directly in the
 * Cognito console — the data rules compare the group name on a record against
 * the caller's `cognito:groups` claim, which needs no deploy-time wiring. So
 * onboarding is: create the group, add the user, set the project's
 * `accessGroup`. No code change, no deploy.
 *
 * A user can belong to several project groups and will see exactly those
 * projects.
 *
 * DEPRECATED: `custom:role` and `custom:projects` drove an earlier 3-tier role
 * scheme that nothing enforced (the data rules were `allow.authenticated()`,
 * and the web app hardcoded every user to "master"). The groups above replace
 * them. The attributes stay declared because Cognito cannot delete a custom
 * attribute once created — removing them here would fail the deploy. Nothing
 * reads them any more; leave them alone.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ["admins"],
  userAttributes: {
    "custom:role": {
      dataType: "String",
      mutable: true,
    },
    "custom:projects": {
      dataType: "String",
      mutable: true,
    },
  },
});
