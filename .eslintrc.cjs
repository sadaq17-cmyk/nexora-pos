/**
 * ESLint (classic config) for Nexora POS Enterprise.
 *
 * Philosophy: catch genuine bugs, not style nits. Stylistic and
 * "unused-in-JSX" style rules are downgraded to warnings so the deploy
 * pipeline is never blocked by cosmetic issues (the lint script also runs
 * with --max-warnings=99999). Only real errors (undefined vars, invalid
 * hook usage, duplicate keys, unreachable code, etc.) fail the lint gate.
 */
module.exports = {
  root: true,
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  settings: {
    react: {
      version: "detect",
    },
  },
  plugins: ["react", "react-hooks", "react-refresh"],
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
  ],
  rules: {
    // Not using PropTypes in this codebase.
    "react/prop-types": "off",
    // Vite/React 17+ automatic JSX runtime — no React import needed.
    "react/react-in-jsx-scope": "off",
    "react/jsx-uses-react": "off",
    // Console logging is allowed in this app.
    "no-console": "off",

    // --- Genuine bugs: keep as errors (from eslint:recommended) ---
    // no-undef, no-dupe-keys, no-unreachable, no-const-assign,
    // no-dupe-args, no-func-assign, etc. remain errors.

    // --- Noisy / stylistic rules downgraded to warnings ---
    "no-unused-vars": [
      "warn",
      { args: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" },
    ],
    "no-empty": ["warn", { allowEmptyCatch: true }],
    "no-extra-boolean-cast": "warn",
    "no-prototype-builtins": "warn",
    "no-useless-escape": "warn",
    "no-fallthrough": "warn",
    "no-case-declarations": "warn",
    "react/no-unescaped-entities": "warn",
    "react/display-name": "warn",
    "react/jsx-key": "warn",
    "react/no-unknown-property": "warn",
    "react-hooks/exhaustive-deps": "warn",

    // Helps keep Fast Refresh working; warning only.
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
  },
};
