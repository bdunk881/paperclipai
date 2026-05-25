import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  buildIntegrationLogoUrl,
  buildLogoDevUrl,
  getLogoDevPublishableKey,
  resolveIntegrationLogoDomain,
} from "../lib/logoDev";

export interface CompanyLogoProps {
  /** Brand display name (also used for alt text and initials fallback). */
  name: string;
  /** Integration/provider id — resolves a known domain when set. */
  integrationId?: string;
  /** Override domain lookup, e.g. `stripe.com`. */
  domain?: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  alt?: string;
  /** Shown when logo.dev is unavailable or the image fails to load. */
  fallback?: ReactNode;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function DefaultFallback({
  name,
  size,
  className,
  style,
}: {
  name: string;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 8,
        background: "var(--af2-paper-2)",
        color: "var(--af2-ink-2)",
        fontSize: Math.max(10, Math.round(size * 0.38)),
        fontWeight: 600,
        fontFamily: "var(--af2-font-serif, inherit)",
        flexShrink: 0,
        ...style,
      }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}

export function CompanyLogo({
  name,
  integrationId,
  domain,
  size = 32,
  className,
  style,
  alt,
  fallback,
}: CompanyLogoProps) {
  const token = getLogoDevPublishableKey();
  const [failed, setFailed] = useState(false);

  const src = useMemo(() => {
    if (!token) return null;
    const resolvedDomain =
      domain?.trim() ||
      (integrationId ? resolveIntegrationLogoDomain(integrationId) : undefined);

    if (integrationId) {
      return buildIntegrationLogoUrl(integrationId, name, token, size);
    }

    return buildLogoDevUrl({
      name,
      domain: resolvedDomain,
      token,
      size,
    });
  }, [domain, integrationId, name, size, token]);

  if (!src || failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <DefaultFallback name={name} size={size} className={className} style={style} />
    );
  }

  return (
    <img
      src={src}
      alt={alt ?? `${name} logo`}
      width={size}
      height={size}
      className={className}
      style={{
        objectFit: "contain",
        flexShrink: 0,
        ...style,
      }}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
