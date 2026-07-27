# Foghaven Art Pipeline

Companion to `docs/ART_BIBLE.md` §12. This is the working directory for
AI-assisted asset generation.

## Folders

- `prompts/` — **committed.** One `.txt` file per generation task. Edit these,
  don't edit generated output.
- `prompts/_style-suffix.txt` — appended to every prompt automatically by
  `genart.mjs`. If the art direction ever changes, this is the one file to edit.
- `generated/` — **gitignored.** Raw output from every run, kept for comparison.
  Safe to delete anytime; it's disposable.
- `approved/` — **committed.** The assets that actually ship, each with a
  `.meta.json` sidecar recording which prompt, model, and references produced it.

## Setup (one-time)

1. Create `.env` in the repo root (same level as `package.json`):
   ```
   GEMINI_API_KEY=your_key_here
   ```
2. Make sure the root `.gitignore` includes:
   ```
   .env
   art/generated/
   ```

## Usage

Generate:
```bash
node scripts/genart.mjs <prompt-name> --model pro|flash|lite --n <count> [--refs name1,name2] [--yes]
```

- `--model pro` (Nano Banana Pro) — use for the character base and anything
  that must stay visually locked to an existing approved asset via `--refs`.
- `--model flash` (Nano Banana 2) — default. Use for props, icons, bulk sheets.
- `--model lite` (Nano Banana 2 Lite) — cheapest, good for rough exploration.
- `--refs` takes comma-separated **asset names already in `art/approved/`**
  (not file paths) — e.g. `--refs character-base-01`.
- Estimated cost prints before anything runs. Above $1 estimated, the script
  stops and asks you to re-run with `--yes`.

Review the output in `art/generated/<prompt-name>/`, then promote the one you want:
```bash
node scripts/approve.mjs art/generated/<prompt-name>/<file>.png <asset-name>
```

Commit everything under `art/approved/` — never anything under `art/generated/`.

## Recommended first run

```bash
node scripts/genart.mjs character-base --model pro --n 4 --yes
```

This is the single most important generation in the whole project — every
cosmetic, every reference-locked asset, and the whole visual identity of the
game traces back to whichever of these four you approve. Take your time
picking.

## Still missing (build later, once real output exists to work against)

- `scripts/cleanup.mjs` — the ART_BIBLE §12.5 pass: background removal,
  palette snapping to the ART_BIBLE §3 tokens, outline colour normalisation,
  downscaling. Worth building against real generated images rather than
  speculatively — ask Claude for it once you have a batch to run it on.
- `npm run atlas` — packs `art/approved/` into a texture atlas with a typed
  manifest. Part of Phase 7 Block A (roadmap 7.3) but not urgent until there
  are enough approved assets to justify it.
