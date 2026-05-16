// HEL-100 follow-up: module augmentation that surfaces the additional
// @xyflow/react components which the package's wildcard re-export chain
// silently drops under TS moduleResolution=bundler.
//
// `@xyflow/react/dist/esm/index.d.ts` does `export * from './additional-components'`
// and that nested barrel does `export * from './MiniMap'` etc., but TS
// only picks up Background / Controls / BackgroundVariant — MiniMap,
// NodeResizer, NodeToolbar, EdgeToolbar are dropped. At runtime the JS
// bundle does export them, so the augmentation is purely a type-system
// patch.
//
// The side-effect `import "@xyflow/react"` turns this file into an
// external module so the `declare module` block augments the existing
// types instead of replacing them (the latter being what happens if
// it's parsed as an ambient module declaration).
//
// Drop this shim if/when upstream fixes the re-export. As of
// @xyflow/react@12.10.2 this is the cleanest workaround that keeps the
// rest of the import surface intact.
import "@xyflow/react";

declare module "@xyflow/react" {
  export type {
    MiniMapProps,
    MiniMapNodeProps,
    GetMiniMapNodeAttribute,
  } from "@xyflow/react/dist/esm/additional-components/MiniMap/types";
  export { MiniMap } from "@xyflow/react/dist/esm/additional-components/MiniMap/MiniMap";
  export { MiniMapNode } from "@xyflow/react/dist/esm/additional-components/MiniMap/MiniMapNode";
}
