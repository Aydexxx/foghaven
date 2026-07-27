#!/usr/bin/env node
/**
 * Promotes a chosen generated asset into art/approved/, which IS committed
 * to the repo. Carries the .meta.json sidecar forward so every approved
 * asset stays traceable to the prompt that produced it (ART_BIBLE §12.3-12.4).
 *
 * Usage:
 *   node scripts/approve.mjs <path-to-generated-png> <asset-name>
 *
 * Example:
 *   node scripts/approve.mjs art/generated/character-base/2026-07-27T10-00-00-2.png character-base-01
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APPROVED_DIR = path.join(REPO_ROOT, 'art', 'approved');

const [, , sourceArg, assetName] = process.argv;

if (!sourceArg || !assetName) {
  console.error('\nUsage: node scripts/approve.mjs <path-to-generated-png> <asset-name>\n');
  process.exit(1);
}

if (!/^[a-z0-9-]+$/.test(assetName)) {
  console.error('Asset name should be lowercase letters, numbers, and hyphens only (e.g. character-base-01).');
  process.exit(1);
}

const sourcePath = path.resolve(REPO_ROOT, sourceArg);
const sourceMetaPath = sourcePath.replace(/\.png$/, '.meta.json');

if (!existsSync(sourcePath)) {
  console.error(`File not found: ${sourcePath}`);
  process.exit(1);
}

mkdirSync(APPROVED_DIR, { recursive: true });

const destImagePath = path.join(APPROVED_DIR, `${assetName}.png`);
const destMetaPath = path.join(APPROVED_DIR, `${assetName}.meta.json`);

if (existsSync(destImagePath)) {
  console.error(`${destImagePath} already exists. Choose a different asset name or delete it first.`);
  process.exit(1);
}

copyFileSync(sourcePath, destImagePath);

if (existsSync(sourceMetaPath)) {
  const meta = JSON.parse(readFileSync(sourceMetaPath, 'utf-8'));
  meta.approvedAt = new Date().toISOString();
  meta.approvedAs = assetName;
  writeFileSync(destMetaPath, JSON.stringify(meta, null, 2));
} else {
  console.warn('No .meta.json sidecar found next to the source file — approving without provenance data.');
}

console.log(`\nApproved: ${path.relative(REPO_ROOT, destImagePath)}`);
console.log('Commit it along with its .meta.json — this directory is tracked by git.\n');
