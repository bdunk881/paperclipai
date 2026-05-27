import { useCallback, useEffect, useState } from "react";

import {
  formatCredits,
  patchDailySpendCap,
  type WalletBalance,
} from "../../api/creditsApi";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../ToastProvider";

interface DailyCapCardProps {
  wallet: WalletBalance | null;
  onSaved: () => void;
}

/**
 * Per-workspace daily credit spend cap (PR B, migration 077).
 *
 * Customer-facing safety guardrail: when set, the credits router refuses
 * to reserve credits once the trailing-24h consumption reaches the cap.
 * Mirrors `platform_provider_keys.daily_spend_cap_usd` on the ops side.
 *
 * Null = no cap. Default for new workspaces is no cap, but customers
 * worried about runaway burn can opt in here.
 */
export function DailyCapCard({ wallet, onSaved }: DailyCapCardProps) {
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const currentCap = wallet?.dailyCapStatus?.cap ?? null;
  const consumedToday = wallet?.dailyCapStatus?.consumedToday ?? "0";

  const [capInput, setCapInput] = useState<string>(currentCap ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCapInput(currentCap ?? "");
  }, [currentCap]);

  const handleSave = useCallback(
    async (nextCap: string | null) => {
      setSaving(true);
      try {
        const token = await requireAccessToken();
        await patchDailySpendCap(token, nextCap);
        toast.success(
          nextCap == null
            ? "Daily cap removed"
            : `Daily cap set to ${formatCredits(nextCap)} credits`,
        );
        onSaved();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update daily cap");
      } finally {
        setSaving(false);
      }
    },
    [requireAccessToken, toast, onSaved],
  );

  const inputValid = (() => {
    if (capInput.trim() === "") return true; // empty = clear
    try {
      const parsed = BigInt(capInput);
      return parsed >= 0n;
    } catch {
      return false;
    }
  })();

  return (
    <div className="card">
      <h3>Daily spend cap</h3>
      <p className="desc" style={{ marginTop: 4 }}>
        Limit how many credits this workspace can burn in a rolling 24-hour
        window. New credits-mode calls are refused once the cap is hit.
        Leave blank for no cap.
      </p>

      <div style={{ display: "grid", gap: 4, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="desc" style={{ fontSize: 12 }}>
            Daily cap (credits):
          </span>
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="No cap"
            value={capInput}
            onChange={(e) => setCapInput(e.target.value)}
            className="input"
            style={{ padding: 6 }}
            disabled={saving}
          />
          {capInput.trim() !== "" ? (
            <span className="desc" style={{ fontSize: 11 }}>
              ≈ {formatCredits(capInput)} credits/day
            </span>
          ) : null}
        </label>
      </div>

      <div className="desc" style={{ marginTop: 10, fontSize: 12 }}>
        Used in the last 24h:{" "}
        <strong>{formatCredits(consumedToday)}</strong>
        {currentCap != null ? (
          <>
            {" "}of <strong>{formatCredits(currentCap)}</strong> (
            {Math.min(
              100,
              Math.round((Number(consumedToday) / Math.max(1, Number(currentCap))) * 100),
            )}
            %)
          </>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void handleSave(capInput.trim() === "" ? null : capInput.trim())}
          disabled={saving || !inputValid}
        >
          {saving ? "Saving…" : currentCap == null ? "Set cap" : "Update cap"}
        </button>
        {currentCap != null ? (
          <button
            type="button"
            className="btn"
            onClick={() => void handleSave(null)}
            disabled={saving}
          >
            Remove cap
          </button>
        ) : null}
      </div>
    </div>
  );
}
