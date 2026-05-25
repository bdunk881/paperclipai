/**
 * Billing page (HEL-213 / PR I).
 *
 * Pulls subscription state from /api/billing/subscription (existing) and
 * payment-method + next-invoice from /api/billing/payment-method and
 * /api/billing/next-invoice (new — backend stubs land alongside this PR).
 * The page degrades gracefully when those endpoints 404.
 *
 * v2 prototype port: docs/design/v2/preview/consolidation.html lines 1413-1455.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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

  const planLabel = subscription
    ? formatSubscriptionTierLabel(subscription.tier)
    : "Free";
  const nextInvoiceAmount = nextInvoice
    ? formatMoney(nextInvoice.amountDue, nextInvoice.currency)
    : "$0.00";
  const nextInvoiceDate = nextInvoice ? formatDate(nextInvoice.periodEnd) : null;
  const renewLabel = subscription?.currentPeriodEnd
    ? subscription.cancelAtPeriodEnd
      ? `Cancels on ${formatDate(subscription.currentPeriodEnd)}`
      : `Renews on ${formatDate(subscription.currentPeriodEnd)}`
    : null;

  const metaLine = [
    `${planLabel} plan`,
    nextInvoice ? `${nextInvoiceAmount}` : null,
    nextInvoiceDate ? `next invoice ${nextInvoiceDate}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="af2-v2">
      <div style={{ maxWidth: 920 }}>
        <div className="page-head">
          <div className="page-head-left">
            <div className="eyebrow">Account · Billing</div>
            <h1 className="h1">Billing</h1>
            <div className="meta">
              {metaLine || "Payment method, next invoice, and subscription controls."}
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
          <>
            <div className="desc-grid">
              {/* ============ Payment method ============ */}
              <div className="card">
                <h3>Payment method</h3>
                {paymentMethod ? (
                  <>
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          width: 48,
                          height: 30,
                          borderRadius: 4,
                          background:
                            "linear-gradient(135deg,#2b6cb0,#1a365d)",
                          color: "#fff",
                          display: "grid",
                          placeItems: "center",
                          fontSize: 11,
                          fontWeight: 700,
                        }}
                      >
                        {paymentMethod.brand.toUpperCase()}
                      </div>
                      <div>
                        ···· {paymentMethod.last4} · expires{" "}
                        {String(paymentMethod.expMonth).padStart(2, "0")}/
                        {String(paymentMethod.expYear).slice(-2)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{ marginTop: 10 }}
                      disabled
                      title="Card updates land alongside HEL-213 PR ii"
                    >
                      Update card
                    </button>
                  </>
                ) : (
                  <>
                    <p className="desc" style={{ marginTop: 6 }}>
                      No card on file. Add a payment method to unlock paid
                      plans and per-seat invites.
                    </p>
                    <Link
                      to="/pricing"
                      className="btn primary"
                      style={{ marginTop: 10 }}
                    >
                      Add card via Stripe
                    </Link>
                  </>
                )}
              </div>

              {/* ============ Next invoice ============ */}
              <div className="card">
                <h3>Next invoice</h3>
                <div
                  style={{
                    fontFamily: "var(--af2-serif)",
                    fontSize: 32,
                    lineHeight: 1,
                  }}
                >
                  {nextInvoiceAmount}
                </div>
                <p className="desc">
                  {nextInvoice
                    ? `Due ${nextInvoiceDate ?? "—"} · ${planLabel} plan`
                    : `${planLabel} plan · no upcoming invoice`}
                </p>
                {renewLabel ? (
                  <p
                    className="desc"
                    style={{ marginTop: 4, fontSize: 12 }}
                  >
                    {renewLabel}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid-3">
              {/* ============ Upgrade ============ */}
              <div className="card">
                <h3>Upgrade subscription</h3>
                <p className="desc">
                  {subscription
                    ? "Move up a tier for unlimited routines + priority support."
                    : "View available plans."}
                </p>
                <Link
                  to="/pricing"
                  className="btn primary"
                  style={{ marginTop: 8 }}
                >
                  {subscription ? "Upgrade →" : "View pricing →"}
                </Link>
              </div>
              {/* ============ Top up tokens ============ */}
              <div className="card">
                <h3>Buy more tokens</h3>
                <p className="desc">
                  One-time top-up for hosted-model usage. $20 = 5M tokens
                  (haiku-equiv).
                </p>
                <Link
                  to="/pricing?topup=tokens"
                  className="btn"
                  style={{ marginTop: 8 }}
                  title="One-time top-up — does not change your subscription tier"
                >
                  Top up
                </Link>
              </div>
              {/* ============ Cancel ============ */}
              <div
                className="card"
                style={{ borderColor: "rgba(194,80,43,0.4)" }}
              >
                <h3 style={{ color: "var(--af2-clay)" }}>
                  Cancel subscription
                </h3>
                <p className="desc">
                  Downgrades to free at next renewal · workspace stays
                  read-only.
                </p>
                {subscription && !subscription.cancelAtPeriodEnd ? (
                  <button
                    type="button"
                    className="btn danger"
                    style={{ marginTop: 8 }}
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn danger"
                    style={{ marginTop: 8 }}
                    disabled
                    title={
                      subscription?.cancelAtPeriodEnd
                        ? "Already scheduled to cancel"
                        : "No active subscription"
                    }
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        <ConfirmDestructiveModal
          open={cancelOpen}
          onClose={() => (cancelling ? undefined : setCancelOpen(false))}
          eyebrow="Billing · Subscription"
          title="Cancel subscription?"
          message="You'll keep paid access until the end of the current billing period, then drop to the free tier. You can resubscribe any time before then to undo this."
          confirmLabel={cancelling ? "Cancelling…" : "Cancel subscription"}
          confirming={cancelling}
          onConfirm={() => void handleCancel()}
        />
      </div>
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
