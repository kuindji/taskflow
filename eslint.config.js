import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
    // Global ignores
    {
        ignores: [
            "**/dist/",
            "**/node_modules/",
            "**/*.js",
            "!eslint.config.js",
            "**/vite.config.ts",
        ],
    },

    // Base JS recommended rules
    eslint.configs.recommended,

    // TypeScript strict type-checked rules
    ...tseslint.configs.strictTypeChecked,

    // TypeScript parser settings
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // Rule overrides for all TS/TSX files
    {
        files: ["**/*.ts", "**/*.tsx"],
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/restrict-template-expressions": [
                "error",
                {
                    allowNumber: true,
                    allowBoolean: true,
                },
            ],
            "@typescript-eslint/no-confusing-void-expression": "off",
            "@typescript-eslint/no-misused-promises": [
                "error",
                {
                    checksVoidReturn: { attributes: false },
                },
            ],
            "@typescript-eslint/no-unnecessary-condition": "off",
            "@typescript-eslint/unbound-method": "off",
            "@typescript-eslint/require-await": "off",
            "@typescript-eslint/no-non-null-assertion": "warn",
        },
    },

    // Backend + Shared: Node/Bun globals
    {
        files: [
            "packages/backend/src/**/*.ts",
            "packages/backend/tests/**/*.ts",
            "packages/shared/src/**/*.ts",
        ],
        languageOptions: {
            globals: {
                ...globals.node,
                Bun: "readonly",
            },
        },
    },

    // Electron: Node globals
    {
        files: ["electron/src/**/*.ts"],
        languageOptions: {
            globals: globals.node,
        },
    },

    // UI: Browser globals + React rules
    {
        files: ["packages/ui/src/**/*.{ts,tsx}"],
        plugins: {
            "react-hooks": reactHooks,
            "react-refresh": reactRefresh,
        },
        languageOptions: {
            globals: globals.browser,
        },
        rules: {
            ...reactHooks.configs.recommended.rules,
            "react-hooks/set-state-in-effect": "off",
            "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
        },
    },

    // eslint.config.js itself: disable type-checking
    {
        files: ["eslint.config.js"],
        ...tseslint.configs.disableTypeChecked,
    },

    // Disable formatting rules that conflict with Prettier (must be last)
    eslintConfigPrettier,
);
