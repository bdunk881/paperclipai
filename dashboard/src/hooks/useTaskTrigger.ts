/**
 * HEL-710: useTaskTrigger — start a run of a template from a browser component
 * and get back a handle to watch it (the trigger.dev useTaskTrigger pattern).
 *
 * trigger(input) mints a short-lived trigger token (authenticated), POSTs it to
 * the public trigger endpoint to start the run, and returns the new runId plus a
 * read token. Feed the runId into useRealtimeRun to follow the run live:
 *
 *   const { trigger, runId } = useTaskTrigger(templateId);
 *   const { status } = useRealtimeRun(runId);
 *   <button onClick={() => trigger({ message: "hi" })} />
 */
import { useCallback, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchTriggerToken, triggerRun, type TriggerRunResponse } from "../api/runsApi";

export interface UseTaskTriggerResult {
  trigger: (input?: Record<string, unknown>) => Promise<TriggerRunResponse | null>;
  runId: string | null;
  /** Read token for the started run (pairs with runId for a sessionless subscribe). */
  token: string | null;
  isTriggering: boolean;
  error: string | null;
  reset: () => void;
}

export function useTaskTrigger(templateId: string | null | undefined): UseTaskTriggerResult {
  const { requireAccessToken } = useAuth();
  const [runId, setRunId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trigger = useCallback(
    async (input?: Record<string, unknown>): Promise<TriggerRunResponse | null> => {
      if (!templateId) {
        setError("No template selected");
        return null;
      }
      setIsTriggering(true);
      setError(null);
      try {
        // Mint a fresh trigger token per trigger — short-lived and avoids any
        // stale-token handling; the cost is one authenticated round-trip.
        const accessToken = await requireAccessToken();
        const { token: triggerToken } = await fetchTriggerToken(accessToken, templateId);
        const result = await triggerRun(triggerToken, templateId, input);
        setRunId(result.runId);
        setToken(result.token);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to trigger run");
        return null;
      } finally {
        setIsTriggering(false);
      }
    },
    [templateId, requireAccessToken],
  );

  const reset = useCallback(() => {
    setRunId(null);
    setToken(null);
    setError(null);
  }, []);

  return { trigger, runId, token, isTriggering, error, reset };
}
