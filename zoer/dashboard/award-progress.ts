export function awardProgress(checkpoint: any): string {
  if (!checkpoint) return '';
  if (checkpoint.version !== 2) return `${checkpoint.count.toLocaleString()} rows processed across ${checkpoint.page.toLocaleString()} pages.`;
  const completed = checkpoint.ranges.filter((r: any) => r.complete).length;
  const active = checkpoint.ranges[checkpoint.active];
  return `${completed.toLocaleString()} of ${checkpoint.ranges.length.toLocaleString()} date ranges checked. ${checkpoint.count.toLocaleString()} rows processed across ${checkpoint.pages.toLocaleString()} pages.${active ? ` Current range: ${active.from} to ${active.to}, page ${checkpoint.page.toLocaleString()}.` : ''} Undated awards are not verified.`;
}
