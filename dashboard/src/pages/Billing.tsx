/**
 * Billing page (HEL-213 / PR I).
 *
 * Pulls subscription state from /api/billing/subscription (existing) and
 * payment-method + next-invoice from /api/billing/payment-method and
 * /api/billing/next-invoice (new — backend stubs land alongside this PR).
 * The page degrades gracefully when those endpoints 404.
 *
 * Surfaces:
 *   - Card on file (brand · last4 · expiry)
 *   - Next invoice (date + amount)
 *   - Plan + Upgrade subscription CTA
 *   - Buy more tokens (one-time top-up — opens pricing)
 *   - Cancel subscription (ConfirmDestructiveModal)
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard } from "lucide-react";
import { trackedFetch } from "../api/trackedFetch";
import { getApiBasePath } from "../api/baseUrl";
import {
  formatSubscriptionTierLabel,
  getWorkspaceSubscription,
  type WorkspaceSubscription,
} from "../api/billingApi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../components/ToastProvider";
import { ErrorState, LoadingState } from "../components/UiStates";
import { ConfirmDestructiveModal } from "../components/missions/ConfirmDestructiveModal";

interface PaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

interface NextInvoice {
  amountDue: number; // cents
  currency: string;
  periodEnd: string; // ISO
}

export default function Billing() {
  const { requireAccessToken } = useAuth();
  const toast = useToast();

  const [subscription, setSubscription] = useState<WorkspaceSubscription | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [nextInvoice, setNextInvoice] = useState<NextInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    document.title = "Billing | AutoFlow";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await requireAccessToken();
      const [subRes, paymentRes, invoiceRes] = await Promise.all([
        getWorkspaceSubscription(token).catch(() => ({
          subscription: null,
          accessLevel: "none" as const,
        })),
        // TODO(HEL-213-billing): /api/billing/payment-method is a stub —
        // backend route lands alongside this PR. Until it does, the
        // payment-method card surfaces "No card on file" gracefully.
        trackedFetch(`${getApiBasePath()}/billing/payment-method`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(async (res) =>
            res.ok ? ((await res.json()) as { paymentMethod: PaymentMethod | null }) : null,
          )
          .catch(() => null),
        trackedFetch(`${getApiBasePath()}/billing/next-invoice`, {
          headers: { Authorization: `Bearer ${token}` },
        })
          .then(async (res) =>
            res.ok ? ((await res.json()) as { invoice: NextInvoice | null }) : null,
          )
          .catch(() => null),
      ]);
      setSubscription(subRes.subscription);
      setPaymentMethod(paymentRes?.paymentMethod ?? null);
      setNextInvoice(invoiceRes?.invoice ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load billing");
    } finally {
      setLoading(false);
    }
  }, [requireAccessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const token = await requireAccessToken();
      const res = await trackedFetch(`${getApiBasePath()}/billing/subscription/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Cancel failed (${res.status})`);
      }
      toast.success(
        "Subscription scheduled to cancel at the end of the current period.",
      );
      setCancelOpen(false);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to cancel subscription";
      toast.error(msg);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="af2-page" style={{ maxWidth: 920 }}>
      <div className="af2-page-head">
        <div>
          <div className="af2-eyebrow">Account · Workspace</div>
          <h1 className="af2-h1" style={{ marginTop: 6 }}>
            Billing
          </h1>
          <div className="af2-page-head-meta">
            Payment method, next invoice, and subscription controls.
          </div>
        </div>
      </div>

      {loading ? (
        <LoadingState label="Loading billing…" />
      ) : error ? (
        <ErrorState
          title="Billing unavailable"
          message={error}
          onRetry={() => void load()}
        />
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          {/* ============ Card on file ============ */}
          <section>
            <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
              Payment method
            </div>
            <div className="af2-card" style={{ padding: 18 }}>
              {paymentMethod ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: "var(--af2-paper-2)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--af2-ink-3)",
                    }}
                  >
                    <CreditCard size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {capitalize(paymentMethod.brand)} ···· {paymentMethod.last4}
                    </div>
                    <div className="af2-muted" style={{ fontSize: 12 }}>
                      Expires {String(paymentMethod.expMonth).padStart(2, "0")}/
                      {String(paymentMethod.expYear).slice(-2)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="af2-btn af2-btn-sm"
                    disabled
                    title="Card updates land alongside HEL-213 PR ii"
                  >
                    Update card
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                    No card on file
                  </div>
                  <p className="af2-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                    Add a payment method to unlock paid plans and per-seat
                    invites.
                  </p>
                  <Link
                    to="/pricing"
                    className="af2-btn af2-btn-sm af2-btn-clay"
                    style={{
                      marginTop: 10,
                      textDecoration: "none",
                      display: "inline-flex",
                    }}
                  >
                    Add card via Stripe
                  </Link>
                </div>
              )}
            </div>
          </section>

          {/* ============ Next invoice ============ */}
          <section>
            <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
              Next invoice
            </div>
            <div className="af2-card" style={{ padding: 18 }}>
              {nextInvoice ? (
                <div className="af2-row">
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 600 }}>
                      {formatMoney(nextInvoice.amountDue, nextInvoice.currency)}
                    </div>
                    <div className="af2-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                      Charges on {formatDate(nextInvoice.periodEnd)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="af2-muted" style={{ fontSize: 13 }}>
                  No upcoming invoice — you’re on the free tier or your
                  subscription is cancelled.
                </div>
              )}
            </div>
          </section>

          {/* ============ Plan ============ */}
          <section>
            <div className="af2-eyebrow" style={{ marginBottom: 8 }}>
              Plan
            </div>
            <div className="af2-card" style={{ padding: 18 }}>
              <div className="af2-row">
                <div>
                  <div className="af2-eyebrow">Current plan</div>
                  <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>
                    {subscription
                      ? formatSubscriptionTierLabel(subscription.tier)
                      : "Free"}
                  </div>
                  {subscription?.currentPeriodEnd ? (
                    <div className="af2-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                      {subscription.cancelAtPeriodEnd
                        ? `Cancels on ${formatDate(subscription.currentPeriodEnd)}`
                        : `Renews on ${formatDate(subscription.currentPeriodEnd)}`}
                    </div>
                  ) : null}
                </div>
                <span className="af2-spacer" />
                {subscription ? (
                  <span
                    className="af2-pill"
                    style={{ textTransform: "capitalize" }}
                  >
                    {subscription.status.replace(/_/g, " ")}
                  </span>
                ) : null}
              </div>

              <div
                style={{
                  marginTop: 16,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <Link
                  to="/pricing"
                  className="af2-btn af2-btn-clay"
                  style={{ textDecoration: "none" }}
                >
                  {subscription ? "Upgrade subscription" : "View pricing"}
                </Link>
                <Link
                  to="/pricing?topup=tokens"
                  className="af2-btn"
                  style={{ textDecoration: "none" }}
                  title="One-time top-up — does not change your subscription tier"
                >
                  Buy more tokens
                </Link>
                {subscription && !subscription.cancelAtPeriodEnd ? (
                  <button
                    type="button"
                    className="af2-btn"
                    onClick={() => setCancelOpen(true)}
                    style={{ color: "var(--af2-clay)" }}
                  >
                    Cancel subscription
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      )}

      <ConfirmDestructiveModal
        open={cancelOpen}
        onClose={() => (cancelling ? undefined : setCancelOpen(false))}
        eyebrow="Billing · Subscription"
        title="Cancel subscription?"
        message="You’ll keep paid access until the end of the current billing period, then drop to the free tier. You can resubscribe any time before then to undo this."
        confirmLabel={cancelling ? "Cancelling…" : "Cancel subscription"}
        confirming={cancelling}
        onConfirm={() => void handleCancel()}
      />
    </div>
  );
}

function formatMoney(cents: number, currency: string): string {
  const value = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatDate(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "—";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
