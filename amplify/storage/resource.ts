import { defineStorage } from "@aws-amplify/backend";

/**
 * S3 storage for point photos, videos, and voice memos.
 *
 * `list` is deliberately absent for ordinary members. It used to be granted via
 * `read` (= get + list), which let any signed-in user enumerate the whole
 * prefix and download every project's media no matter how tight the GraphQL
 * rules were. Without it, the only way to reach an object is to know its key,
 * and keys are UUIDs that only appear on point records the caller is already
 * authorized to read. Nothing to redeploy when a project is added.
 *
 * `get`/`write`/`delete` stay broad: a member who knows a key can overwrite or
 * delete it, but the only keys they can learn are their own project's. If that
 * ever needs closing, the next step is per-group key prefixes with rules to
 * match, or serving media through presigned URLs from a Lambda.
 *
 * Admins keep `list` so `scripts/backup.ts` and any bulk export can walk the
 * bucket. Run those as an admin account.
 *
 * `name` must stay `pointPhotos`: changing it provisions a new bucket and
 * orphans everything already uploaded.
 */
export const storage = defineStorage({
  name: "pointPhotos",
  access: (allow) => ({
    "point-photos/*": [
      allow.authenticated.to(["get", "write", "delete"]),
      allow.groups(["admins"]).to(["get", "list", "write", "delete"]),
    ],
  }),
});
