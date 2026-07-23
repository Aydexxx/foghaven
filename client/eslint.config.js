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
);
