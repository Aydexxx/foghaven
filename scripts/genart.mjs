#!/usr/bin/env node
/**
 * Foghaven asset generator — calls Google's Gemini image models to produce
 * game art from the prompts in art/prompts/, following docs/ART_BIBLE.md §12.
 *
 * Usage:
 *   node scripts/genart.mjs <prompt-name> [--model pro|flash|lite] [--n <count>]
 *                           [--refs name1,name2,...] [--yes]
 *
 * Examples:
 *   node scripts/genart.mjs character-base --model pro --n 4
 *   node scripts/genart.mjs cosmetic-hats --model flash --refs character-base-01 --n 2
 *
 * Output:
 *   art/generated/<prompt-name>/<ISO-timestamp>-<index>.png
 *   art/generated/<prompt-name>/<ISO-timestamp>-<index>.meta.json
 *
 * Nothing here is committed automatically — art/generated/ should be gitignored.
 * See scripts/approve.mjs to promote a chosen output into art/approved/, which
 * IS committed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Model IDs as seen in this project's own Google AI Studio account (July 2026).
// Verify against https://ai.google.dev/gemini-api/docs/models before a large
// batch run — Google renames/deprecates image model IDs periodically, and
// AI Studio's playground ID is not always identical to the API's ID.
const MODELS = {
  pro:   { id: 'gemini-3-pro-image',        pricePerImage: 0.134,  label: 'Nano Banana Pro' },
  flash: { id: 'gemini-3.1-flash-image',      pricePerImage: 0.0672, label: 'Nano Banana 2' },
  lite:  { id: 'gemini-3.1-flash-lite-image', pricePerImage: 0.0336, label: 'Nano Banana 2 Lite' },
};

const CONFIRM_THRESHOLD_USD = 1.00; // require --yes above this estimated cost
const GENERATED_DIR = path.join(REPO_ROOT, 'art', 'generated');
const APPROVED_DIR  = path.join(REPO_ROOT, 'art', 'approved');
const PROMPTS_DIR   = path.join(REPO_ROOT, 'art', 'prompts');
const STYLE_SUFFIX_PATH = path.join(PROMPTS_DIR, '_style-suffix.txt');

// ---------------------------------------------------------------------------
// .env loader (no dependency — just enough to read GEMINI_API_KEY from the
// repo-root .env). If you already load .env another way in this project,
// this simply won't override an existing process.env value.
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const envPath = path.join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error(
    '\nGEMINI_API_KEY not found.\n' +
    `Create a file at ${path.join(REPO_ROOT, '.env')} containing:\n\n` +
    '  GEMINI_API_KEY=your_key_here\n'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { model: 'flash', n: 1, refs: [], yes: false, promptName: null };
  const rest = [...argv];
  args.promptName = rest.shift();

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--model') args.model = rest[++i];
    else if (arg === '--n') args.n = parseInt(rest[++i], 10);
    else if (arg === '--refs') args.refs = rest[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--yes') args.yes = true;
    else console.warn(`Unknown argument: ${arg}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.promptName) {
  console.error(
    '\nUsage: node scripts/genart.mjs <prompt-name> [--model pro|flash|lite] ' +
    '[--n <count>] [--refs name1,name2] [--yes]\n'
  );
  process.exit(1);
}

if (!MODELS[args.model]) {
  console.error(`Unknown model "${args.model}". Choose one of: ${Object.keys(MODELS).join(', ')}`);
  process.exit(1);
}

if (!Number.isInteger(args.n) || args.n < 1) {
  console.error(`--n must be a positive integer, got: ${args.n}`);
  process.exit(1);
}

const modelConfig = MODELS[args.model];

// ---------------------------------------------------------------------------
// Resolve prompt text: base prompt file + style suffix (ART_BIBLE §12.2)
// ---------------------------------------------------------------------------

function loadPrompt(name) {
  const promptPath = path.join(PROMPTS_DIR, `${name}.txt`);
  if (!existsSync(promptPath)) {
    console.error(`Prompt file not found: ${promptPath}`);
    console.error(`Available prompts live in: ${PROMPTS_DIR}`);
    process.exit(1);
  }
  const basePrompt = readFileSync(promptPath, 'utf-8').trim();

  if (!existsSync(STYLE_SUFFIX_PATH)) {
    console.error(`Style suffix file not found: ${STYLE_SUFFIX_PATH}`);
    process.exit(1);
  }
  const styleSuffix = readFileSync(STYLE_SUFFIX_PATH, 'utf-8').trim();

  return `${basePrompt}\n\n${styleSuffix}`;
}

const fullPrompt = loadPrompt(args.promptName);

// ---------------------------------------------------------------------------
// Resolve reference images (Pro only — flash/lite may ignore them; warn)
// ---------------------------------------------------------------------------

function loadRefs(refNames) {
  if (refNames.length === 0) return [];
  if (args.model !== 'pro') {
    console.warn(
      `Warning: --refs was passed but model "${args.model}" does not reliably ` +
      `honour reference images. Consider --model pro for reference-locked work.\n`
    );
  }
  return refNames.map(name => {
    const refPath = path.join(APPROVED_DIR, `${name}.png`);
    if (!existsSync(refPath)) {
      console.error(`Reference asset not found: ${refPath}`);
      console.error('Reference images must already be approved — see scripts/approve.mjs');
      process.exit(1);
    }
    const data = readFileSync(refPath).toString('base64');
    return { mimeType: 'image/png', data };
  });
}

const refImages = loadRefs(args.refs);

// ---------------------------------------------------------------------------
// Cost estimate + confirmation gate
// ---------------------------------------------------------------------------

const estimatedCost = modelConfig.pricePerImage * args.n;

console.log(`\nModel:    ${modelConfig.label} (${modelConfig.id})`);
console.log(`Prompt:   ${args.promptName}`);
console.log(`Refs:     ${args.refs.length > 0 ? args.refs.join(', ') : '(none)'}`);
console.log(`Count:    ${args.n}`);
console.log(`Estimate: ~$${estimatedCost.toFixed(3)} (${modelConfig.label} @ ~$${modelConfig.pricePerImage}/image, standard resolution)`);
console.log('Note: this is a rough estimate from published per-image pricing, not a live quote.\n');

if (estimatedCost > CONFIRM_THRESHOLD_USD && !args.yes) {
  console.log(`This exceeds the $${CONFIRM_THRESHOLD_USD} confirmation threshold.`);
  console.log('Re-run the exact same command with --yes added to proceed.\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Call the Gemini API
// ---------------------------------------------------------------------------

async function generateOne() {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelConfig.id}:generateContent?key=${API_KEY}`;

  const parts = [
    ...refImages.map(img => ({ inlineData: img })),
    { text: fullPrompt },
  ];

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API error (${res.status}): ${errText.slice(0, 800)}`);
  }

  const json = await res.json();
  const imagePart = json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);

  if (!imagePart) {
    throw new Error(`No image in response. Raw response: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return Buffer.from(imagePart.inlineData.data, 'base64');
}

async function main() {
  const outDir = path.join(GENERATED_DIR, args.promptName);
  mkdirSync(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let succeeded = 0;

  for (let i = 0; i < args.n; i++) {
    console.log(`Generating ${i + 1}/${args.n}...`);
    try {
      const imageBuffer = await generateOne();
      const baseName = `${timestamp}-${i}`;
      const imagePath = path.join(outDir, `${baseName}.png`);
      const metaPath = path.join(outDir, `${baseName}.meta.json`);

      writeFileSync(imagePath, imageBuffer);
      writeFileSync(metaPath, JSON.stringify({
        promptName: args.promptName,
        promptFile: `art/prompts/${args.promptName}.txt`,
        resolvedPrompt: fullPrompt,
        model: modelConfig.id,
        modelLabel: modelConfig.label,
        refs: args.refs,
        generatedAt: new Date().toISOString(),
      }, null, 2));

      console.log(`  -> ${path.relative(REPO_ROOT, imagePath)}`);
      succeeded++;
    } catch (err) {
      console.error(`  Failed: ${err.message}`);
    }
  }

  console.log(`\nDone. ${succeeded}/${args.n} succeeded. Review outputs in ${path.relative(REPO_ROOT, outDir)}`);
  console.log('Approve a good one with: node scripts/approve.mjs <path-to-png> <asset-name>\n');
}

main();
