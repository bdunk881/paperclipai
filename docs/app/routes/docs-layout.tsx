import { Outlet } from "react-router";

import { DocsLayout } from "~/components/DocsLayout";

export default function DocsLayoutRoute() {
  return (
    <DocsLayout>
      <Outlet />
    </DocsLayout>
  );
}
