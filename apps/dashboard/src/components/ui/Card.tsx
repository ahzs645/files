import { type ReactNode } from "react";

const plugin = Boolean(import.meta.env.VITE_ZOER_PLUGIN);

export function Card({
  children,
  className = "",
  padding = true,
}: {
  children: ReactNode;
  className?: string;
  padding?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded-2xl border border-border-default bg-bg-surface backdrop-blur-xl ${padding ? (plugin ? "p-4" : "p-5") : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  eyebrow,
  title,
  icon: Icon,
  action,
}: {
  eyebrow: string;
  title: string;
  icon?: React.ComponentType<{ size?: number }>;
  action?: ReactNode;
}) {
  if (plugin) {
    return (
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
        {action}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-4 mb-5">
      <div>
        <div className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-accent mb-2">
          {Icon ? <Icon size={13} /> : null}
          <span>{eyebrow}</span>
        </div>
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      </div>
      {action}
    </div>
  );
}
