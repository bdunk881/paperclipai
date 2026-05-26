/**
 * Centralized async loaders for ESM-only provider SDKs.
 *
 * Why: the project compiles TS to CommonJS (`tsconfig.json` →
 * `module: "commonjs"`), so a static `import { Mistral } from
 * "@mistralai/mistralai"` becomes a `require()` at runtime — and
 * `require()`-ing an ESM-only package throws `ERR_REQUIRE_ESM`. The
 * `Function('return import("…")')()` shape below is a literal dynamic
 * `import()` that TypeScript doesn't rewrite, so it survives to runtime
 * as a real Node dynamic-ESM import.
 *
 * The side effect of using `Function(...)` is that Jest's module
 * mocking (`jest.mock("@mistralai/mistralai", ...)`) can't intercept the
 * call — Jest hooks `require()` / `import()` at the AST level, and
 * `Function('return import(…)')()` is opaque to that hook. Tests instead
 * `jest.mock("./sdkLoaders", ...)` and stub the loader.
 *
 * Today only Mistral needs this. Vertex AI and Bedrock ship CJS;
 * `@google/generative-ai` ships CJS. Keep this file focused on the
 * narrow set of ESM-only packages — adding a loader here for a CJS
 * package would just be deadweight.
 */

export async function loadMistralSdk(): Promise<typeof import("@mistralai/mistralai")> {
  const mod = (await (Function(
    'return import("@mistralai/mistralai")',
  )() as Promise<typeof import("@mistralai/mistralai")>));
  return mod;
}
