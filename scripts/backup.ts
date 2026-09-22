/**
 * Full backup of the Bai Tracker backend to local disk.
 *
 * Reads everything through the app's own GraphQL API using a normal user
 * login — no AWS console or IAM access required, because the schema grants
 * every authenticated user read access to all Projects and Points
 * (see amplify/data/resource.ts) and to point-photos/* in S3
 * (see amplify/storage/resource.ts).
 *
 * Writes:
 *   backup/<timestamp>/projects.json   every Project record
 *   backup/<timestamp>/points.json     every Point record
 *   backup/<timestamp>/manifest.json   counts, backend ids, photo results
 *   backup/<timestamp>/photos/<key>    every photo/video, under its S3 key
 *
 * The backend it talks to is whatever amplify_outputs.json points at.
 *
 * Usage:
 *   npx tsx scripts/backup.ts <email> <password>
 *   npx tsx scripts/backup.ts <email> <password> --skip-photos
 */
import { Amplify } from "aws-amplify";
import { signIn, signOut } from "aws-amplify/auth";
import { generateClient } from "aws-amplify/data";
import { getUrl } from "aws-amplify/storage";
import type { Schema } from "../amplify/data/resource";
import outputs from "../amplify_outputs.json";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const email = process.argv[2];
const password = process.argv[3];
const skipPhotos = process.argv.includes("--skip-photos");

if (!email || !password) {
  console.error("Usage: npx tsx scripts/backup.ts <email> <password> [--skip-photos]");
  process.exit(1);
}

/** Pages through a list() until nextToken runs out, so nothing is missed. */
async function listAll<T>(
  fetchPage: (nextToken?: string) => Promise<{ data: T[]; nextToken?: string | null; errors?: unknown }>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;
  let page = 0;
  do {
    const result = await fetchPage(nextToken);
    if (result.errors) throw new Error(`Failed to list ${label}: ${JSON.stringify(result.errors)}`);
    all.push(...result.data);
    nextToken = result.nextToken ?? undefined;
    page++;
    process.stdout.write(`\r  ${label}: ${all.length} (page ${page})   `);
  } while (nextToken);
  process.stdout.write("\n");
  return all;
}

async function main() {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = join("backup", stamp);

  console.log(`Backend: ${outputs.data.url}`);
  console.log(`Signing in as ${email}…`);
  Amplify.configure(outputs);
  await signIn({ username: email, password });
  console.log("Signed in.\n");

  const client = generateClient<Schema>();

  console.log("Reading records…");
  const projects = await listAll(
    (nextToken) => client.models.Project.list({ limit: 1000, nextToken }),
    "projects",
  );
  const points = await listAll(
    (nextToken) => client.models.Point.list({ limit: 1000, nextToken }),
    "points",
  );

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "projects.json"), JSON.stringify(projects, null, 2));
  await writeFile(join(outDir, "points.json"), JSON.stringify(points, null, 2));

  // Every photo/video key referenced by any point, de-duplicated.
  const keys = [...new Set(points.flatMap((p) => (p.photos ?? []).filter((k): k is string => !!k)))];
  const photoResults: { key: string; bytes?: number; error?: string }[] = [];

  if (skipPhotos) {
    console.log(`\nSkipping ${keys.length} photo(s) (--skip-photos).`);
  } else if (keys.length > 0) {
    console.log(`\nDownloading ${keys.length} photo/video file(s)…`);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const dest = join(outDir, "photos", key);
      try {
        const { url } = await getUrl({ path: key });
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, buffer);
        photoResults.push({ key, bytes: buffer.byteLength });
      } catch (err) {
        // Keep going — one missing object must not abort the whole backup.
        photoResults.push({ key, error: err instanceof Error ? err.message : String(err) });
      }
      process.stdout.write(`\r  ${i + 1}/${keys.length}   `);
    }
    process.stdout.write("\n");
  }

  const failed = photoResults.filter((r) => r.error);
  const bytes = photoResults.reduce((sum, r) => sum + (r.bytes ?? 0), 0);

  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        backedUpBy: email,
        backend: {
          appsyncUrl: outputs.data.url,
          region: outputs.data.aws_region,
          userPoolId: outputs.auth.user_pool_id,
          bucket: outputs.storage?.bucket_name,
        },
        counts: {
          projects: projects.length,
          points: points.length,
          photoKeys: keys.length,
          photosDownloaded: photoResults.length - failed.length,
          photosFailed: failed.length,
          photoBytes: bytes,
        },
        photos: photoResults,
      },
      null,
      2,
    ),
  );

  console.log(`\nSaved to ${outDir}`);
  console.log(`  projects : ${projects.length}`);
  console.log(`  points   : ${points.length}`);
  if (!skipPhotos) {
    console.log(`  photos   : ${photoResults.length - failed.length}/${keys.length} (${(bytes / 1e6).toFixed(1)} MB)`);
    if (failed.length) {
      console.log(`  FAILED   : ${failed.length} — see manifest.json`);
      for (const f of failed.slice(0, 5)) console.log(`    ${f.key}: ${f.error}`);
    }
  }

  await signOut();
  process.exit(failed.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("\nBackup failed:", err);
  process.exit(1);
});
