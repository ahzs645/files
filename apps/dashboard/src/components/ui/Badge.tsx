import { type ReactNode } from "react";

const variants = {
  open: "bg-green-muted text-green",
  closed: "bg-red-muted text-red",
  neutral: "bg-bg-subtle text-text-secondary",
} as const;

export function Badge({
  children,
  variant = "neutral",
}: {
  children: ReactNode;
  variant?: keyof typeof variants;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider ${variants[variant]}`}
    >
      {children}
    </span>
  );
}
