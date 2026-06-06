/**
 * Lazily-constructed singleton `@composio/core` client on the shared project
 * key (HEL-721 / project HEL-720).
 *
 * LAZY DYNAMIC IMPORT — deliberate. `@composio/core` is ESM-first
 * (`"type": "module"`). Importing it statically into our CommonJS backend
 * (ts-node / ts-jest) triggers ERR_REQUIRE_ESM and breaks module-eval under
 * jest — the same class of failure HEL-492 fixed for the ESM-only
 * `@mistralai/mistralai` llmProviders chain. Deferring to `await import()`
 * keeps boot + the jest import graph off that chain and only loads the SDK when
 * the broker is actually used.
 *
 * Type-only references to the package are fine (erased at compile time); it is
 * the *runtime* `require` we must avoid.
 */
import { composioApiBaseUrl, composioApiKeyOrThrow } from "./config";

/** The constructed Composio client instance type, resolved type-only from the SDK. */
export type ComposioBrokerClient = Awaited<ReturnType<typeof construct>>;

async function construct() {
  const { Composio } = await import("@composio/core");
  const baseURL = composioApiBaseUrl();
  return new Composio({
    apiKey: composioApiKeyOrThrow(),
    // Backend broker — opt out of the SDK's anonymous usage telemetry.
    allowTracking: false,
    ...(baseURL ? { baseURL } : {}),
  });
}

let clientPromise: Promise<ComposioBrokerClient> | null = null;

/**
 * Returns the shared-project Composio client (constructed once, then cached).
 * Gate on `isComposioEnabled()` before calling — this throws if the key is
 * absent.
 */
export function getComposioBroker(): Promise<ComposioBrokerClient> {
  if (!clientPromise) {
    clientPromise = construct();
  }
  return clientPromise;
}

/** Test helper: drop the cached client so the next call reconstructs it. */
export function resetComposioBrokerForTests(): void {
  clientPromise = null;
}
