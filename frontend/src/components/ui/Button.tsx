import type { ButtonHTMLAttributes } from "react";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-wine text-on-wine border border-wine-dark/40 shadow-sm hover:bg-wine-dark hover:shadow-md",
  secondary: "bg-surface text-ink border border-line-strong hover:border-gold hover:bg-sunken",
  ghost: "text-ink hover:bg-sunken border border-transparent",
  danger: "bg-surface text-err border border-err/40 hover:bg-err-soft",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[13px] gap-1.5",
  md: "h-10 px-5 text-sm gap-2",
};

// Pill-shaped, with a gentle press; the focus ring comes from globals.css (:focus-visible).
export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `inline-flex items-center justify-center rounded-full font-medium tracking-[0.01em] whitespace-nowrap transition-[background-color,border-color,box-shadow,transform] duration-200 active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant = "secondary", size = "md", loading, disabled, className = "", children, ...rest }: Props) {
  return (
    <button
      type="button"
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
