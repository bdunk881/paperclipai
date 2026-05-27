import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { formatCredits, getWalletBalance, type WalletBalance } from "../../api/creditsApi";
import { useAuth } from "../../context/AuthContext";

/**
 * Always-visible credit-balance reminder in the topbar.
 *
 * Hidden entirely when balance is 0 (e.g. a BYOK-only workspace that
 * never used the signup trial credits) so non-credits workspaces don't
 * see a confusing "0" badge. Once a workspace touches credits, the
 * widget surfaces:
 *   - Normal: ink-coloured "{compactBalance} credits"
 *   - Low (lowBalance flag from balance endpoint): mustard
 *   - Cap reached (dailyCapStatus.capReached): clay
 *
 * Clicks navigate to /billing where the customer can top up or adjust
 * the daily cap.
 *
 * Polls every 60s so a wallet that goes from healthy → low while the
 * user is on another page updates without a hard reload. Process-local
 * — no global cache to invalidate.
 */
export function CreditsTopbarWidget() {
  const { requireAccessToken, user } = useAuth();
  const [wallet, setWallet] = useState<WalletBalance | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function fetchOnce(): Promise<void> {
      try {
        const token = await requireAccessToken();
        const balance = await getWalletBalance(token);
        if (!cancelled) setWallet(balance);
      } catch {
        // Silent — the widget is best-effort. A failed fetch shouldn't
        // surface a banner; the user will see the real error on /billing.
      }
    }

    void fetchOnce();
    const interval = setInterval(() => {
      void fetchOnce();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, requireAccessToken]);

  if (!wallet) return null;
  const balance = wallet.balanceCredits;
  // BigInt-as-string comparison: any non-zero balance shows the widget.
  if (balance === "0" || balance === "") return null;

  const capReached = wallet.dailyCapStatus?.capReached === true;
  const lowBalance = wallet.lowBalance === true;

  const baseClasses =
    "hidden h-8 items-center rounded-full border px-3 text-[11px] font-semibold transition sm:inline-flex";
  const colorClasses = capReached
    ? "border-af2-clay bg-af2-clay/10 text-af2-clay hover:bg-af2-clay/20"
    : lowBalance
      ? "border-af2-mustard bg-af2-mustard/10 text-af2-mustard hover:bg-af2-mustard/20"
      : "border-af2-line bg-af2-paper-2 text-af2-ink-2 hover:text-af2-ink";

  const title = capReached
    ? "Daily credit cap reached — click to adjust"
    : lowBalance
      ? "Credit balance is running low — click to top up"
      : "Credits available — click to manage";

  return (
    <Link
      to="/billing"
      className={`${baseClasses} ${colorClasses}`}
      title={title}
      data-testid="credits-topbar-widget"
    >
      <span style={{ marginRight: 4 }}>●</span>
      {formatCredits(balance)} credits
    </Link>
  );
}
