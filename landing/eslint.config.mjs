// HEL-178: landing is a React Router 7 app, not a Next.js app. The
// previous config extended `next/core-web-vitals` + `next/typescript`,
// which flagged React Router patterns (raw `<a>` links, custom fonts
// in root.tsx) as errors despite being correct for this stack. The
// new flat config uses plain ESLint + typescript-eslint + react-hooks
// — no Next.js opinions.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "out/**",
      "build/**",
      ".react-router/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Sanity config + scripts pass extra args; not worth fighting.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
