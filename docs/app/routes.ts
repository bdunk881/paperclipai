import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/docs-layout.tsx", [
    index("routes/home.tsx"),
    route("getting-started", "routes/getting-started.tsx"),
    route("api-reference", "routes/api-reference.tsx"),
    route("integrations-sdk-v1", "routes/integrations-sdk-v1.tsx"),
  ]),
] satisfies RouteConfig;
