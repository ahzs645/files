import { Search, X } from "lucide-react";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border-default bg-bg-subtle px-3.5 min-h-[44px] flex-1 min-w-[240px] focus-within:border-accent/30 transition-colors">
      <Search size={15} className="text-text-tertiary shrink-0" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-sm text-text-primary placeholder:text-text-tertiary"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="text-text-tertiary hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>
      ) : null}
    </label>
  );
}
