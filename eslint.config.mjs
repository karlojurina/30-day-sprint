import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated + stub files for the Node test harness. They run under
    // `node --experimental-strip-types`, so they use explicit .ts import
    // extensions and keep unused stub parameters that mirror the real
    // signatures they stand in for. Neither is app code.
    "client-tests/_gen/**",
  ]),
]);

export default eslintConfig;
