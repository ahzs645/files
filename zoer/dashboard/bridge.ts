import { createRequestQueue } from './request-queue';
const enqueue = createRequestQueue(4);
let sequence = 0;
const requests = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
window.addEventListener('message', event => {
  if (event.source !== window.parent || event.data?.channel !== 'zoer-workspace-v1') return;
  const request = requests.get(event.data.id);
  if (!request) return;
  requests.delete(event.data.id); clearTimeout(request.timer);
  event.data.error ? request.reject(new Error(event.data.error)) : request.resolve(event.data.result);
});
export function host(method: string, input?: unknown): Promise<any> {
  // Opened directly (no parent frame) the window would answer its own postMessage with empty results.
  if (window.parent === window) return Promise.reject(new Error('Open this dashboard inside Zoer, for example http://localhost:5180/#/plugins/bc-bid-monitor during local development.'));
  return enqueue(() => new Promise((resolve, reject) => {
    const id = `bcbid-${++sequence}`;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('Zoer workspace request timed out.')); }, 45000);
    requests.set(id, { resolve, reject, timer });
    window.parent.postMessage({ channel: 'zoer-workspace-v1', id, method, input }, '*');
  }));
}
