// @ts-check
import tseslint from "typescript-eslint";
import i18next from "eslint-plugin-i18next";

/**
 * Deliberately minimal — this exists for exactly one job: catching a
 * hardcoded user-facing string before it ships, as a durable version of the
 * "verify no hardcoded strings" pre-launch audit (which found zero at the
 * time this was added — see the audit notes). Not a general lint setup:
 * no style rules, nothing beyond what's needed to parse TSX, run
 * `i18next/no-literal-string`, and recognize the `react-hooks/exhaustive-deps`
 * suppressions already scattered through the codebase (registering the
 * plugin, not enabling extra rules beyond what's already relied on).
 */
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      i18next,
      "react-hooks": (await import("eslint-plugin-react-hooks")).default,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "i18next/no-literal-string": [
        "error",
        {
          // JSX text content only — not every string literal in the file
          // (object keys, CSS class names, Phaser API strings, etc. are not
          // the class of bug this guards against).
          mode: "jsx-text-only",
          words: {
            // Decorative icon glyphs used as button content instead of an
            // SVG (⛶ ⌨️ 🛡️ ✕ ⚑ 🎙️, and any other symbol-only text) —
            // not translatable prose, so not a literal-string violation.
            exclude: [/^[^a-zA-Z]*$/],
          },
        },
      ],
    },
  },
  {
    // Test files, and GameScene.ts's Phaser API string literals (key codes,
    // texture/animation keys, tilemap data) — internal engine plumbing, never
    // rendered to a player, and not remotely the class of bug this guards
    // against.
    files: ["src/**/*.test.{ts,tsx}", "src/game/**/*.ts"],
    rules: {
      "i18next/no-literal-string": "off",
    },
  },
  {
    // No hardcoded hex colors anywhere in the client outside theme/ — see
    // docs/ART_BIBLE.md §3 and src/theme/tokens.ts. Catches both string hex
    // ("#ffffff", "#000000aa") and Phaser's numeric hex (0xffffff).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/theme/**"],
    rules: {
      // The docs/TOKEN_DEBT.md repaint (Phase 7.13) is done — every
      // remaining hex literal outside theme/ has been moved to an
      // ART_BIBLE §3 token (or, for palettes that answer a different
      // question than "what does the world look like" — colour-blind
      // badges, minigame tile IDs — to their own dedicated theme/ token
      // file). Nothing left for this to flag, so it's an error now.
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]",
          message:
            "No hardcoded hex colors outside theme/ — use a token from src/theme/tokens.ts (see docs/ART_BIBLE.md §3).",
        },
        {
          selector: "Literal[raw=/^0[xX][0-9a-fA-F]{6,8}$/]",
          message:
            "No hardcoded hex colors outside theme/ — use a token from src/theme/tokens.ts (see docs/ART_BIBLE.md §3).",
        },
      ],
    },
  },
);
