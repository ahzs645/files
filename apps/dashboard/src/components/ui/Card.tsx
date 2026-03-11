import { type ReactNode } from "react";

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
      className={`rounded-2xl border border-border-default bg-bg-surface backdrop-blur-xl ${padding ? "p-5" : ""} ${className}`}
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
  return (
    <div className="flex items-start justify-between gap-4 mb-5">
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
