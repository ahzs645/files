import { type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

const variants = {
  primary:
    "bg-gradient-to-br from-accent-strong/30 to-accent/15 border-accent/20 hover:border-accent/40 text-text-primary",
  success:
    "bg-gradient-to-br from-green/25 to-green/10 border-green/20 hover:border-green/40 text-green",
  danger:
    "bg-gradient-to-br from-red/25 to-red/10 border-red/20 hover:border-red/40 text-red",
  ghost:
    "bg-bg-subtle border-border-default hover:bg-bg-hover hover:border-border-strong text-text-primary",
};

export function Button({
  children,
  variant = "primary",
  loading = false,
  disabled = false,
  onClick,
  className = "",
}: {
  children: ReactNode;
  variant?: keyof typeof variants;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center gap-2.5 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all duration-150 hover:-translate-y-px active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {loading ? <LoaderCircle size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
