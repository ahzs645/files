import { describe, it, expect } from 'vitest';
import { CONFIGURE_SECTIONS, PRIMARY_SECTIONS, pageOf, redirectOf, sectionOf, viewHref, viewOf } from '../zoer/dashboard/review-workspace/nav';

describe('review workspace navigation', () => {
  it('has six primary sections and a separate Configure group', () => {
    expect(PRIMARY_SECTIONS.map(([id]) => id)).toEqual(['home', 'opportunities', 'pursuits', 'documents', 'evidence', 'insights']);
    expect(CONFIGURE_SECTIONS.map(([id]) => id)).toEqual(['workbench', 'profiles', 'sources', 'taxonomy']);
    // Every size uses one full name for a section.
    expect([...PRIMARY_SECTIONS, ...CONFIGURE_SECTIONS].every(tab => tab.length === 3)).toBe(true);
  });
  it('maps every existing and new route to its section', () => {
    const cases: [string, string][] = [
      ['/', 'home'], ['/home', 'home'],
      ['/procurement', 'opportunities'], ['/procurement?view=matrix', 'opportunities'], ['/opportunities', 'opportunities'], ['/opportunities/123', 'opportunities'],
      ['/pursuits', 'pursuits'], ['/evidence', 'evidence'], ['/documents', 'documents'],
      ['/insights', 'insights'], ['/analysis/overview', 'insights'], ['/analysis', 'insights'], ['/contract-awards', 'insights'], ['/contract-awards/analysis/suppliers/x', 'insights'], ['/contract-awards/runs', 'insights'],
      ['/ai-review', 'workbench'], ['/workbench', 'workbench'], ['/profiles', 'profiles'],
      ['/sources', 'sources'], ['/bc-bid-dashboard', 'sources'], ['/scraper', 'sources'], ['/scraper/history', 'sources'], ['/settings', 'sources'],
    ];
    for (const [route, section] of cases) expect([route, sectionOf(route)]).toEqual([route, section]);
    // Prefix look-alikes are not captured by another section.
    expect(sectionOf('/opportunitiesx')).toBe('sources');
    expect(sectionOf('/contract-awardsx')).toBe('sources');
  });
  it('redirects a bare root to Home and keeps old root search links on the review table', () => {
    expect(redirectOf('/')).toBe('/home');
    expect(redirectOf('/?search=roof&source=bc-bid')).toBe('/procurement?search=roof&source=bc-bid&kind=all');
    expect(redirectOf('/?view=board')).toBe('/procurement?view=board');
    for (const route of ['/home', '/procurement', '/opportunities/123', '/documents', '/sources']) expect(redirectOf(route)).toBeNull();
  });
  it('opens old Grid links as the Opportunities table with their filters', () => {
    expect(redirectOf('/opportunities')).toBe('/procurement?layout=table');
    const target = new URL('http://x' + redirectOf('/opportunities?search=roof&status=Open|Closed&type=RFP&sources=bc-bid|canadabuys&organization=City&buyerLevel=source&starred=1')).searchParams;
    expect(Object.fromEntries(target)).toEqual({ layout: 'table', search: 'roof', tableStatus: 'Open|Closed', tableType: 'RFP', tableSources: 'bc-bid|canadabuys', organization: 'City', buyerLevel: 'source', shortlist: '1' });
  });
  it('identifies the active view inside a section', () => {
    expect(viewOf('/procurement')).toBe('table');
    expect(viewOf('/procurement?view=table&queue=decide')).toBe('table');
    expect(viewOf('/procurement?view=matrix')).toBe('matrix');
    expect(viewOf('/procurement?view=compare')).toBe('compare');
    expect(viewOf('/procurement?view=deadlines')).toBe('table');
    // A saved record opened from an old link still belongs to the list.
    expect(viewOf('/opportunities/5')).toBe('table');
    // Evidence is a single-view section; Documents' Download/Files/History are views.
    expect(viewOf('/evidence')).toBe('');
    expect(viewOf('/documents')).toBe('download');
    expect(viewOf('/documents?tab=history')).toBe('history');
    expect(viewOf('/insights')).toBe('decisions');
    expect(viewOf('/analysis/sources')).toBe('market');
    expect(viewOf('/contract-awards/analysis/organizations/a')).toBe('market');
    expect(viewOf('/contract-awards')).toBe('awards');
    expect(viewOf('/workbench')).toBe('stages');
    expect(viewOf('/ai-review')).toBe('reviews');
    expect(viewOf('/ai-review?view=analysis')).toBe('analysis');
    expect(viewOf('/pursuits')).toBe('');
  });
  it('switches opportunity views without losing the filter scope', () => {
    expect(viewHref('opportunities', 'matrix', '/procurement?source=bc-bid&queue=acquire&page=3&notice=x')).toBe('/procurement?source=bc-bid&queue=acquire&view=matrix');
    expect(viewHref('opportunities', 'table', '/procurement?view=matrix&relevance=strong')).toBe('/procurement?relevance=strong');
    // Grid is gone as a view: the list keeps its presentation while moving between views.
    expect(viewHref('opportunities', 'matrix', '/procurement?layout=table&source=bc-bid')).toBe('/procurement?layout=table&source=bc-bid&view=matrix');
    expect(viewHref('opportunities', 'compare', '/opportunities')).toBe('/procurement?view=compare');
    expect(viewHref('insights', 'awards', '/insights')).toBe('/contract-awards');
  });
  it('keeps the record picker state when switching Documents and AI review views', () => {
    expect(viewHref('documents', 'files', '/documents?search=roof&source=bc-bid')).toBe('/documents?search=roof&source=bc-bid&tab=files');
    expect(viewHref('documents', 'download', '/documents?tab=history&search=roof')).toBe('/documents?search=roof');
    expect(viewHref('workbench', 'analysis', '/ai-review?search=bridge&kind=award')).toBe('/ai-review?search=bridge&kind=award&view=analysis');
    expect(viewHref('workbench', 'reviews', '/ai-review?view=analysis&search=bridge')).toBe('/ai-review?search=bridge');
    // A different page starts fresh.
    expect(viewHref('workbench', 'stages', '/ai-review?search=bridge')).toBe('/workbench');
    expect(viewHref('workbench', 'reviews', '/workbench?x=1')).toBe('/ai-review');
  });
  it('chooses the page component for shell-owned routes and defers the rest to the router', () => {
    expect(pageOf('/home')).toBe('home');
    expect(pageOf('/insights?all=1')).toBe('insights');
    expect(pageOf('/evidence')).toBe('evidence');
    expect(pageOf('/documents')).toBe('documents');
    expect(pageOf('/profiles')).toBe('profiles');
    expect(pageOf('/workbench')).toBe('workbench');
    expect(pageOf('/procurement?view=matrix')).toBe('procurement');
    for (const route of ['/opportunities', '/contract-awards', '/analysis/overview', '/bc-bid-dashboard', '/scraper']) expect(pageOf(route)).toBe('router');
  });
});
