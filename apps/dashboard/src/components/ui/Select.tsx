import { ChevronDown } from "lucide-react";

export function Select({
  value,
  onChange,
  options,
  icon: Icon,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-border-default bg-bg-subtle px-3 min-h-[44px]">
      {Icon ? <Icon size={14} className="text-text-tertiary shrink-0" /> : null}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent outline-none text-sm text-text-primary pr-6 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="absolute right-3 text-text-tertiary pointer-events-none" />
    </div>
  );
}
