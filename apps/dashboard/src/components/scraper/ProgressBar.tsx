export function ProgressBar({
  percent,
  label,
  showPercent = true,
}: {
  percent: number;
  label?: string;
  showPercent?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        aria-label={label}
      >
        <div
          className="h-full rounded-full progress-fill-gradient transition-all duration-500 ease-out"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      {(label || showPercent) && (
        <div className="flex items-center justify-between text-xs">
          {label ? <span className="text-text-secondary">{label}</span> : <span />}
          {showPercent ? <span className="font-medium text-text-primary">{percent}%</span> : null}
        </div>
      )}
    </div>
  );
}
