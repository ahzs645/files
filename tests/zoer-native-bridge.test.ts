// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { bindNativeHost, host, subscribeHost } from '../zoer/dashboard/bridge';

afterEach(() => vi.restoreAllMocks());
test('native requests call the host directly, without window messaging', async () => {
  const post = vi.spyOn(window, 'postMessage');
  const request = vi.fn(async () => ({ rows: ['saved'] }));
  const release = bindNativeHost({ request, subscribe: () => () => {} });
  try {
    expect(await host('catalog.query', { statement: 'SELECT 1' })).toEqual({rows:['saved']});
    expect(request).toHaveBeenCalledWith('catalog.query', {statement:'SELECT 1'});
    expect(post).not.toHaveBeenCalled();
  } finally { release(); }
});
test('catalog SQL reads are serialized without blocking other workspace requests', async () => {
  const finish: Array<() => void> = [];
  const request = vi.fn((method: string) => method === 'catalog.query'
    ? new Promise(resolve => finish.push(() => resolve({ rows: [] })))
    : Promise.resolve({ ready: true }));
  const release = bindNativeHost({ request, subscribe: () => () => {} });
  try {
    const reads = Array.from({ length: 2 }, () => host('catalog.query'));
    expect(await host('state')).toEqual({ ready: true });
    expect(finish).toHaveLength(1);
    finish[0]();
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish.slice(1).forEach(resolve => resolve());
    await expect(Promise.all(reads)).resolves.toEqual(Array.from({ length: 2 }, () => ({ rows: [] })));
  } finally { release(); }
});
test('closing a workspace fences in-flight and queued calls before another mount', async () => {
  let finish!: (value: unknown) => void;
  const oldRequest = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const release = bindNativeHost({request:oldRequest,subscribe:()=>()=>{}});
  const pending = host('state');
  await Promise.resolve();
  release();
  const nextRequest = vi.fn(async()=>({new:true}));
  const releaseNext = bindNativeHost({request:nextRequest,subscribe:()=>()=>{}});
  finish({old:true});
  await expect(pending).rejects.toThrow('Workspace closed');
  expect(nextRequest).not.toHaveBeenCalled();
  expect(await host('state')).toEqual({new:true});
  releaseNext();
  await expect(host('state')).rejects.toThrow('Open this dashboard inside Zoer');
});
test('native navigation subscriptions disconnect on cleanup', () => {
  const listeners = new Set<(event:string,result:any)=>void>();
  const release = bindNativeHost({ request:vi.fn(), subscribe:listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};} });
  const listener = vi.fn(); const unsubscribe = subscribeHost(listener);
  for(const receive of listeners) receive('navigation',{location:'/opportunities'});
  expect(listener).toHaveBeenCalledWith('navigation',{location:'/opportunities'});
  unsubscribe(); expect(listeners.size).toBe(0); release();
});
test('queued old-workspace requests never reach the replacement host', async () => {
  const finishes: Array<(value: unknown) => void> = [];
  const request = vi.fn(() => new Promise(resolve => finishes.push(resolve)));
  const release = bindNativeHost({request,subscribe:()=>()=>{}});
  const pending = Array.from({length:5},()=>host('catalog.read'));
  const results = Promise.allSettled(pending);
  await Promise.resolve(); await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(4);
  release();
  const replacement = vi.fn(async()=>({new:true}));
  const releaseNext = bindNativeHost({request:replacement,subscribe:()=>()=>{}});
  finishes.forEach(finish=>finish({old:true}));
  expect((await results).every(result=>result.status==='rejected')).toBe(true);
  expect(replacement).not.toHaveBeenCalled();
  releaseNext();
});
