import { defineConfig } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import globals from "globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default defineConfig([
  {
    extends: compat.extends(
      "eslint:recommended",
      "plugin:prettier/recommended",
    ),

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },

    rules: {
      // possible problems
      "array-callback-return": 2,
      "no-await-in-loop": 2,
      "no-constructor-return": 2,
      "no-duplicate-imports": 2,
      "no-promise-executor-return": 2,
      "no-self-compare": 2,
      "no-template-curly-in-string": 2,
      "no-unmodified-loop-condition": 2,
      "no-unreachable-loop": 2,
      "no-use-before-define": [2, "nofunc"],
      "require-atomic-updates": 2,

      // suggestions
      "accessor-pairs": 2,
      "arrow-body-style": 2,
      "consistent-return": 2,
      "dot-notation": 2,
      eqeqeq: [2, "smart"],
      "func-name-matching": 2,
      "grouped-accessor-pairs": 2,
      "new-cap": 2,
      "no-array-constructor": 2,
      "no-caller": 2,
      "no-else-return": 2,
      "no-extend-native": 2,
      "no-extra-bind": 2,
      "no-extra-label": 2,
      "no-invalid-this": 2,
      "no-iterator": 2,
      "no-labels": 2,
      "no-lone-blocks": 2,
      "no-lonely-if": 2,
      "no-loop-func": 2,
      "no-new": 2,
      "no-new-wrappers": 2,
      "no-object-constructor": 2,
      "no-proto": 2,
      "no-return-assign": 2,
      "no-sequences": 2,
      "no-throw-literal": 2,
      "no-undef-init": 2,
      "no-unneeded-ternary": 2,
      "no-unused-expressions": 2,
      "no-useless-call": 2,
      "no-useless-computed-key": 2,
      "no-useless-concat": 2,
      "no-useless-constructor": 2,
      "no-useless-escape": 2,
      "no-useless-rename": 2,
      "no-useless-return": 2,
      "no-var": 2,
      "no-void": 2,
      "no-with": 2,
      "object-shorthand": 2,
      "prefer-arrow-callback": 2,
      "prefer-const": 2,
      "prefer-promise-reject-errors": 2,
      "prefer-rest-params": 2,
      "prefer-spread": 2,
      "prefer-numeric-literals": 2,
      "prefer-template": 2,
      "prefer-regex-literals": 2,
      "require-await": 2,
      strict: 2,
      yoda: 2,
    },
  },
]);
