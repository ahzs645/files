import { SearchX } from "lucide-react";

export function EmptyState({ message = "No opportunities match the current filters." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-default py-16 px-8 text-center">
      <SearchX size={32} className="text-text-tertiary mb-4" />
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  );
}
