// Lint rules are the factory's cheapest sensors: they run on every edit (the
// Claude hooks), every commit and every pull request. Each custom message is
// written for whoever reads it next, human or agent, and says what to do
// instead. Existing breaches live in eslint-suppressions.json: new code must
// follow every rule, and the refactor queue works the old ones off (docs/FACTORY.md).
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwind from "eslint-plugin-better-tailwindcss";

// Class names that are not Tailwind utilities on purpose: CSS hooks styled in
// globals.css, and named groups and peers.
const NOT_TAILWIND = ["sheet", "nav-progress", "^group/.+$", "^peer/.+$"];

const DOMAINS = ["auth", "calendar", "config", "dates", "errors", "jobs", "lab", "library", "life", "study", "tasks"];

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Design system: the palette, type scale and components live in
  // src/app/globals.css and src/components/ui.tsx. See docs/DESIGN.md.
  {
    files: ["src/**/*.tsx"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: { "better-tailwindcss": { entryPoint: "src/app/globals.css" } },
    rules: {
      "better-tailwindcss/no-unknown-classes": ["error", { ignore: NOT_TAILWIND }],
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "error",
      "better-tailwindcss/no-deprecated-classes": "error",
      "better-tailwindcss/enforce-canonical-classes": "error",
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: "^(.*:)?text-\\[\\d+(\\.\\d+)?px\\]$",
              message:
                "One-off font size. Use a step of the type scale in globals.css @theme; if none fits, add a token there so every page shares it (docs/DESIGN.md).",
            },
            {
              pattern:
                "^(.*:)?(bg|text|fill|stroke|border|ring|outline|from|via|to|shadow|decoration)-\\[#[0-9a-fA-F]{3,8}\\]$",
              message:
                "Raw hex colour. Use a palette token from globals.css @theme (aqua, mint, coral, sand, …); add a token there if the palette lacks it.",
            },
            {
              pattern: "^(.*:)?(text|fill|stroke|placeholder)-neutral-(200|300|400|500)$",
              message:
                "Raw grey for text. Use the text role that says why it is grey: bright, body, muted or faint (globals.css @theme, docs/DESIGN.md).",
            },
          ],
        },
      ],
    },
  },

  // Architecture: see docs/ARCHITECTURE.md for the layers these rules keep.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/tasks/native", "@/lib/tasks/asana"],
              message:
                "Pages never import a task backend, or TASK_BACKEND=asana breaks. Import from @/lib/tasks/tracker or a @/lib/portal function instead.",
            },
            {
              group: ["@/lib/supabase/session"],
              message: "Only src/proxy.ts refreshes the session. Pages use @/lib/supabase/server.",
            },
          ],
        },
      ],
    },
  },
  {
    files: DOMAINS.map((d) => `src/lib/${d}/**/*.ts`),
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/connector/*", "@/lib/connector/*"],
              message:
                "Domain code must not depend on the Claude connector (it creates a cycle: the connector calls the domains). Choosing the database client belongs in src/lib/supabase.",
            },
            {
              group: ["**/portal/*", "@/lib/portal/*"],
              message:
                "Domain code sits below the portal layer and must not import it. Move the shared piece down into the domain, or into src/lib/dates or src/lib/config.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // A file-level import cycle makes load order matter and hides coupling.
      "import/no-cycle": ["error", { ignoreExternal: true }],
    },
  },

  globalIgnores([
    ".next/**",
    "node_modules/**",
    "supabase/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
    ".claude/worktrees/**",
  ]),
]);
