export function awardProgress(checkpoint: any): string {
  if (!checkpoint) return '';
  if (checkpoint.version !== 2) return `${checkpoint.count.toLocaleString()} rows processed across ${checkpoint.page.toLocaleString()} pages.`;
  const completed = checkpoint.ranges.filter((r: any) => r.complete).length;
  const active = checkpoint.ranges[checkpoint.active];
  // "9999-12-31" marks an open-ended range in saved checkpoints; it is never shown as a date.
  const day = (value: unknown) => typeof value === 'string' && !/^9999-12-31/.test(value) ? value : null;
  const range = active ? [day(active.from), day(active.to)] : [];
  const current = active && (range[0] || range[1]) ? ` Current range: ${range[0] ?? 'start'} to ${range[1] ?? 'open-ended'}, page ${checkpoint.page.toLocaleString()}.` : '';
  return `${completed.toLocaleString()} of ${checkpoint.ranges.length.toLocaleString()} date ranges checked. ${checkpoint.count.toLocaleString()} rows processed across ${checkpoint.pages.toLocaleString()} pages.${current} Undated awards are not verified.`;
}
