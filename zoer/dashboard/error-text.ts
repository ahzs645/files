/** Short labels for the long, repeated run errors; callers keep the full message in a title tooltip. */
const SHORT: [RegExp, string][] = [
  [/browser verification required|requires a browser check/i, 'Browser check needed. Complete it in the Zoer browser, then retry.'],
  [/attachment control is missing or ambiguous/i, 'Attachment link not found. Capture the notice details again.'],
  [/document request guard|did not finish setting up/i, 'The saved browser timed out. Check it, then retry.'],
  [/download did not start|no document download completed/i, 'Download did not start. Check the saved browser, then retry.'],
  [/stopped from plugin dashboard/i, 'Stopped.'],
];
export function shortError(message: string | null | undefined): string {
  if (!message) return '';
  return SHORT.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}
