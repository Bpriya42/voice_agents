import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      ".claude/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    // Server code logs through server/src/logger.ts only (arch §3.7, AGENTS.md).
    files: ["server/src/**/*.ts"],
    rules: { "no-console": "error" },
  },
  {
    // The client may read VITE_E2E and nothing else from import.meta.env.
    files: ["web/src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":not(MemberExpression[property.name='VITE_E2E']) > MemberExpression[object.type='MetaProperty'][property.name='env']",
          message:
            "Only import.meta.env.VITE_E2E may be read in the client. Public values come from /api/health.",
        },
      ],
    },
  },
);
