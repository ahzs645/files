import type { LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: number | string;
  accent: string;
  icon: LucideIcon;
}

export function StatCard({ accent, icon: Icon, label, value }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card__icon" style={{ color: accent, backgroundColor: `${accent}20` }}>
        <Icon size={18} />
      </div>
      <div>
        <div className="stat-card__value">{value}</div>
        <div className="stat-card__label">{label}</div>
      </div>
    </div>
  );
}
