import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Af2ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface Af2ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: Af2ButtonVariant;
  small?: boolean;
}

const VARIANT_CLASS: Record<Af2ButtonVariant, string> = {
  primary: "af2-btn-primary",
  secondary: "",
  ghost: "af2-btn-ghost",
  danger: "af2-btn-clay",
};

/** Thin wrapper around v2 `.af2-btn` styles. */
export function Af2Button({
  children,
  variant = "secondary",
  small = false,
  className,
  type = "button",
  ...rest
}: Af2ButtonProps) {
  const classes = [
    "af2-btn",
    VARIANT_CLASS[variant],
    small ? "af2-btn-sm" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
