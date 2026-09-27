import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Access is scoped per project by Cognito group.
 *
 * Every Project and Point carries an `accessGroup` naming the group allowed to
 * touch it. `allow.groupDefinedIn` reads that field off the record and compares
 * it to the caller's `cognito:groups`, so AppSync does the filtering: a
 * member's `listProjects` returns only their projects, an admin's returns all
 * of them. Nothing to filter client-side, and no call site to forget.
 *
 * `accessGroup` is optional on purpose. Records that predate this change have
 * no value, match no group, and stay visible to `admins` only — the safe
 * default, and no backfill needed before deploying.
 *
 * Point repeats its project's `accessGroup` because AppSync evaluates auth per
 * record: a Point cannot inherit its Project's rule. Both apps stamp it from
 * the selected project when creating.
 */
const schema = a.schema({
  Project: a
    .model({
      name: a.string().required(),
      lat: a.float().required(),
      lng: a.float().required(),
      zoom: a.float(),
      coordinateSystemEpsg: a.string(),
      coordinateSystemName: a.string(),
      coordinateUnits: a.string(),
      coordinateSystemConfirmed: a.boolean(),
      verticalDatum: a.string(),
      elevationUnits: a.string(),

      /** Cognito group allowed to see this project. */
      accessGroup: a.string(),

      points: a.hasMany("Point", "projectId"),
    })
    .authorization((allow) => [
      allow.group("admins"),
      // Members can read and edit their project but not create new ones:
      // creating would let them add project folders they weren't given.
      allow.groupDefinedIn("accessGroup").to(["read", "update", "delete"]),
    ]),

  Point: a
    .model({
      date: a.string().required(),
      time: a.string(),
      location: a.string(),
      lng: a.float().required(),
      lat: a.float().required(),
      pointNumber: a.integer(),
      elevation: a.float(),
      description: a.string(),
      photos: a.string().array(),
      timezone: a.string(),
      comments: a.string().array(),
      category: a.string(),

      /** Copy of the parent project's `accessGroup`; see the note above. */
      accessGroup: a.string(),

      projectId: a.id(),
      project: a.belongsTo("Project", "projectId"),
    })
    .authorization((allow) => [
      allow.group("admins"),
      // Full CRUD within their own project, create included: on create AppSync
      // checks the `accessGroup` being written against the caller's groups, so
      // a member cannot file a point into a project they don't belong to.
      allow.groupDefinedIn("accessGroup"),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
