/**
 * Lists projects with their access groups, and assigns a group to a project.
 *
 * Each project names the Cognito group allowed to see it in `accessGroup`
 * (see amplify/data/resource.ts). New projects get that set when they're
 * created, but projects made before per-project access existed have it empty,
 * which means admins only. This is how you hand one to a client.
 *
 * Points carry their own copy of the group — AppSync evaluates access per
 * record, so a point can't inherit its project's rule. Assigning a project
 * therefore rewrites every point in it too, otherwise the client would see the
 * project and none of its data.
 *
 * Sign in as a member of `admins` — only admins can see every project or
 * change these values.
 *
 * Usage:
 *   npx tsx scripts/access-group.ts <email> <password> list
 *   npx tsx scripts/access-group.ts <email> <password> set <projectId> <group>
 *   npx tsx scripts/access-group.ts <email> <password> clear <projectId>
 *
 * The group must already exist in Cognito and the name must match exactly —
 * a mismatch shows the client an empty project list with no error.
 */
import { Amplify } from "aws-amplify";
import { signIn, signOut } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";
import outputs from "../amplify_outputs.json";

const [email, password, command, projectId, group] = process.argv.slice(2);

const USAGE = `Usage:
  npx tsx scripts/access-group.ts <email> <password> list
  npx tsx scripts/access-group.ts <email> <password> set <projectId> <group>
  npx tsx scripts/access-group.ts <email> <password> clear <projectId>`;

if (!email || !password || !command) {
  console.error(USAGE);
  process.exit(1);
}
if (command !== "list" && command !== "set" && command !== "clear") {
  console.error(`Unknown command "${command}".\n${USAGE}`);
  process.exit(1);
}
if ((command === "set" || command === "clear") && !projectId) {
  console.error(`"${command}" needs a project id. Run "list" first.\n${USAGE}`);
  process.exit(1);
}
if (command === "set" && !group) {
  console.error(`"set" needs a group name.\n${USAGE}`);
  process.exit(1);
}

Amplify.configure(outputs);

const client = generateClient<Schema>();

/** Pages through a list() until nextToken runs out, so nothing is missed. */
async function listAll<T>(
  page: (nextToken?: string) => Promise<{
    data: T[];
    nextToken?: string | null;
    errors?: unknown;
  }>,
  label: string
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;
  do {
    const result = await page(nextToken);
    if (result.errors) throw new Error(`Failed to list ${label}: ${JSON.stringify(result.errors)}`);
    all.push(...result.data);
    nextToken = result.nextToken ?? undefined;
  } while (nextToken);
  return all;
}

async function listProjects() {
  const projects = await listAll(
    (nextToken) => client.models.Project.list({ limit: 1000, nextToken }),
    "projects"
  );
  if (projects.length === 0) {
    console.log("No projects visible to this account.");
    return;
  }
  console.log(`${projects.length} project(s):\n`);
  for (const project of projects) {
    console.log(`  ${project.id}`);
    console.log(`    name:         ${project.name}`);
    console.log(`    access group: ${project.accessGroup ?? "(unassigned — admins only)"}\n`);
  }
}

async function assign(next: string | null) {
  const { data: project, errors } = await client.models.Project.update({
    id: projectId,
    accessGroup: next,
  });
  if (errors) throw new Error(`Failed to update project: ${JSON.stringify(errors)}`);
  if (!project) throw new Error(`No project with id ${projectId}.`);

  // Every point needs the same group, or the client sees an empty project.
  const points = await listAll(
    (nextToken) =>
      client.models.Point.list({
        filter: { projectId: { eq: projectId } },
        limit: 1000,
        nextToken,
      }),
    "points"
  );

  let updated = 0;
  const failures: string[] = [];
  for (const point of points) {
    const { errors: pointErrors } = await client.models.Point.update({
      id: point.id,
      accessGroup: next,
    });
    if (pointErrors) {
      failures.push(`${point.id}: ${JSON.stringify(pointErrors)}`);
    } else {
      updated += 1;
    }
  }

  console.log(
    next
      ? `"${project.name}" is now visible to members of "${next}".`
      : `"${project.name}" is now unassigned — admins only.`
  );
  console.log(`Updated ${updated} of ${points.length} point(s) in the project.`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} point(s) failed — rerun to retry:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
}

async function main() {
  await signOut().catch(() => {}); // clear any cached session from a prior run
  await signIn({ username: email, password });

  if (command === "list") {
    await listProjects();
  } else {
    await assign(command === "set" ? group : null);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => signOut().catch(() => {}));
