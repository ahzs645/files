import { createRequestQueue } from './request-queue';
const enqueue = createRequestQueue(4);
export type NativeHost = {
  request(method: string, input?: unknown): Promise<any>;
  subscribe(listener: (event: string, result: any) => void): () => void;
};
let nativeHost: NativeHost | undefined;
export function bindNativeHost(value: NativeHost) {
  nativeHost = value;
  return () => { if (nativeHost === value) nativeHost = undefined; };
}
export function subscribeHost(listener: (event: string, result: any) => void) {
  if (nativeHost) return nativeHost.subscribe(listener);
  const receive = (event: MessageEvent) => {
    if (event.source === window.parent && event.data?.channel === 'zoer-workspace-v1') listener(event.data.event, event.data.result);
  };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}
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
  const binding = nativeHost;
  if (binding) return enqueue(async () => {
    if (nativeHost !== binding) throw new Error('Workspace closed.');
    const result = await binding.request(method, input);
    if (nativeHost !== binding) throw new Error('Workspace closed.');
    return result;
  });
  // Opened directly (no parent frame) the window would answer its own postMessage with empty results.
  if (window.parent === window) return Promise.reject(new Error('Open this dashboard inside Zoer, for example http://localhost:5180/#/plugins/bc-bid-monitor during local development.'));
  return enqueue(() => new Promise((resolve, reject) => {
    const id = `bcbid-${++sequence}`;
    const timer = setTimeout(() => { requests.delete(id); reject(new Error('Zoer workspace request timed out.')); }, 45000);
    requests.set(id, { resolve, reject, timer });
    window.parent.postMessage({ channel: 'zoer-workspace-v1', id, method, input }, '*');
  }));
}
