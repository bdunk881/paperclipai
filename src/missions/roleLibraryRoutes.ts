/**
 * Role library route.
 *
 * `dashboard/src/components/missions/LibraryRolePicker.tsx` imports
 * `getRoleLibrary` from `dashboard/src/api/missionsApi.ts`, which calls
 * this endpoint to fetch `DEFAULT_ROLE_LIBRARY`. Before this route existed
 * the import dangled and the dashboard typecheck failed in CI.
 */

import { Router } from "express";
import { DEFAULT_ROLE_LIBRARY } from "../goals/teamAssembly";

export const roleLibraryRoutes = Router();

roleLibraryRoutes.get("/", (_req, res) => {
  res.json({ roleLibrary: DEFAULT_ROLE_LIBRARY });
});
