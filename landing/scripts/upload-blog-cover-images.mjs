#!/usr/bin/env node
/**
 * Upload the generated v2 marketing blog cover images to Sanity and attach them
 * to draft blog posts only. Published documents are never patched directly.
 *
 * Required env:
 *   SANITY_AUTH_TOKEN (write token for koldjrka/production)
 * Optional env:
 *   SANITY_PROJECT_ID (defaults koldjrka)
 *   SANITY_DATASET (defaults production)
 */

import { createReadStream, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@sanity/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coversDir = resolve(__dirname, "../public/blog/covers");
const manifestPath = join(coversDir, "cover-image-manifest.json");

const projectId = process.env.SANITY_PROJECT_ID ?? "koldjrka";
const dataset = process.env.SANITY_DATASET ?? "production";
const token = process.env.SANITY_AUTH_TOKEN;

if (!token) {
  console.error("SANITY_AUTH_TOKEN is required to upload and stage blog covers.");
  process.exit(1);
}

const client = createClient({
  projectId,
  dataset,
  token,
  useCdn: false,
  apiVersion: "2026-06-05",
});

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function stripSystemFields(doc) {
  const { _createdAt, _updatedAt, _rev, ...draftable } = doc;
  return draftable;
}

async function ensureDraft(postId) {
  const draftId = `drafts.${postId}`;
  const existingDraft = await client.getDocument(draftId);
  if (existingDraft) return draftId;

  const published = await client.getDocument(postId);
  if (!published) {
    throw new Error(`Cannot create ${draftId}: published document ${postId} was not found.`);
  }

  await client.createIfNotExists({ ...stripSystemFields(published), _id: draftId });
  return draftId;
}

async function uploadOne(item) {
  const filePath = join(coversDir, item.file);
  const asset = await client.assets.upload("image", createReadStream(filePath), {
    filename: item.file,
    contentType: "image/png",
  });

  const draftId = await ensureDraft(item.postId);
  await client
    .patch(draftId)
    .set({
      coverImage: {
        _type: "image",
        asset: { _type: "reference", _ref: asset._id },
        alt: item.alt,
      },
    })
    .commit({ autoGenerateArrayKeys: true });

  return { slug: item.slug, draftId, assetId: asset._id };
}

const results = [];
for (const item of manifest) {
  results.push(await uploadOne(item));
}

console.log(`Staged ${results.length} cover images in ${projectId}/${dataset}:`);
for (const result of results) {
  console.log(`- ${result.slug}: ${result.draftId} -> ${result.assetId}`);
}
