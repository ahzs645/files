/** Source estimates and saved byte counts use the same units. An unavailable size stays unknown. */
export function fileSize(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0) return 'Size unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
