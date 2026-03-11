import { type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

const variants = {
  info: { bg: "bg-accent-muted", text: "text-accent", Icon: Info },
  success: { bg: "bg-green-muted", text: "text-green", Icon: CheckCircle2 },
  error: { bg: "bg-red-muted", text: "text-red", Icon: AlertCircle },
};

export function Banner({
  children,
  variant = "info",
  onDismiss,
}: {
  children: ReactNode;
  variant?: keyof typeof variants;
  onDismiss?: () => void;
}) {
  const { bg, text, Icon } = variants[variant];
  return (
    <div className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm ${bg} ${text}`}>
      <Icon size={16} className="shrink-0" />
      <span className="flex-1">{children}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} className="opacity-60 hover:opacity-100 transition-opacity">
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
