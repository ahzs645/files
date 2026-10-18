// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from '@tanstack/react-router';
import { bindNativeHost } from '../zoer/dashboard/bridge';
import { connectNavigation, disconnectNavigation, navigatePlugin, pluginHref, readHrefBase, routerLocation } from '../zoer/dashboard/navigation';

type Listener = (event: string, result: unknown) => void;
function connect(read: Record<string, unknown>, write: (input: unknown) => unknown = () => undefined) {
  const listeners = new Set<Listener>();
  const release = bindNativeHost({
    request: async (method, input) => method === 'navigation.read' ? read : method === 'navigation.write' ? write(input) : null,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  });
  const history = createMemoryHistory();
  return { history, ready: connectNavigation(history), publish: (event: string, result: unknown) => listeners.forEach(listener => listener(event, result)), release };
}
let release = () => {};
afterEach(() => { disconnectNavigation(); release(); });

describe('in-plugin links', () => {
  it('keeps Zoer hash links when the host sends no hrefBase', async () => {
    const host = connect({ version: 1, location: '/home', baseUrl: 'http://localhost:5180/' }); release = host.release;
    await host.ready;
    expect(pluginHref('/procurement?notice=a')).toBe('http://localhost:5180/#/plugins/bc-bid-monitor/procurement?notice=a');
    expect(pluginHref('/')).toBe('http://localhost:5180/#/plugins/bc-bid-monitor');
    expect(host.history.createHref('/contract-awards')).toBe('/contract-awards');
  });
  it('builds hrefBase + location for every in-plugin anchor, router links included', async () => {
    const host = connect({ version: 1, location: '/home', baseUrl: 'https://societyer.test/', hrefBase: '/demo/app/procurement-review' }); release = host.release;
    await host.ready;
    expect(pluginHref('/procurement?notice=a%2Fb')).toBe('/demo/app/procurement-review/procurement?notice=a%2Fb');
    expect(pluginHref('/home')).toBe('/demo/app/procurement-review/home');
    expect(host.history.createHref('/contract-awards?search=roof')).toBe('/demo/app/procurement-review/contract-awards?search=roof');
    expect(host.history.createHref('/contract-awards/analysis?x=1')).toBe('/demo/app/procurement-review/analysis/overview?x=1');
    // Unmounting restores the router's own hrefs and forgets the prefix.
    disconnectNavigation();
    expect(host.history.createHref('/contract-awards')).toBe('/contract-awards');
    expect(pluginHref('/home')).toBe('https://societyer.test/#/plugins/bc-bid-monitor/home');
  });
  it('takes hrefBase from navigation events and write results too', async () => {
    const host = connect({ version: 1, location: '/home', baseUrl: 'https://societyer.test/' }, () => ({ version: 1, location: '/pursuits', baseUrl: 'https://societyer.test/', hrefBase: '/app/review/' })); release = host.release;
    await host.ready;
    host.publish('navigation', { version: 1, location: '/insights', baseUrl: 'https://societyer.test/', hrefBase: '/demo/app/procurement-review' });
    expect(pluginHref('/insights')).toBe('/demo/app/procurement-review/insights');
    navigatePlugin('/pursuits');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pluginHref('/pursuits')).toBe('/app/review/pursuits');
  });
  it('accepts only absolute path prefixes', () => {
    expect(readHrefBase('/demo/app/procurement-review/')).toBe('/demo/app/procurement-review');
    for (const value of ['https://evil.test/x', '//evil.test', 'relative/path', '/a?b', '/a#b', 7, null]) expect([value, readHrefBase(value)]).toEqual([value, '']);
    expect(routerLocation('/contract-awards/analysis')).toBe('/analysis/overview');
    expect(routerLocation('/contract-awards/analysis/suppliers/x')).toBe('/contract-awards/analysis/suppliers/x');
  });
});
