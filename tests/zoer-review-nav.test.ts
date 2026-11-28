import { describe, it, expect } from 'vitest';
import { OPERATE_SECTIONS, PRIMARY_SECTIONS, SECTION_VIEWS, SHELL_PATHS, pageOf, redirectOf, sectionOf, viewHref, viewOf } from '../zoer/dashboard/review-workspace/nav';

describe('review workspace navigation', () => {
  it('has four daily sections, then Operations and Setup', () => {
    expect(PRIMARY_SECTIONS.map(([id]) => id)).toEqual(['home', 'opportunities', 'pursuits', 'insights']);
    expect(OPERATE_SECTIONS.map(([id, label, to]) => [id, label, to])).toEqual([['operations', 'Operations', '/status'], ['setup', 'Setup', '/profiles']]);
    expect([...PRIMARY_SECTIONS, ...OPERATE_SECTIONS].map(([, label]) => label)).toEqual(['Home', 'Opportunities', 'Pursuits', 'Insights', 'Operations', 'Setup']);
    // Every size uses one full name for a section.
    expect([...PRIMARY_SECTIONS, ...OPERATE_SECTIONS].every(tab => tab.length === 3)).toBe(true);
  });
  it('lists every section\'s views with their labels and routes', () => {
    const views = Object.fromEntries(Object.entries(SECTION_VIEWS).map(([section, list]) => [section, list!.map(([id, label, to]) => `${id}:${label}:${to}`)]));
    expect(views).toEqual({
      opportunities: ['table:Browse:/procurement', 'matrix:Fit matrix:/procurement?view=matrix', 'compare:Compare:/procurement?view=compare', 'evidence:Evidence:/evidence', 'files:Files:/files'],
      insights: ['decisions:Decisions:/insights', 'awards:Awards:/contract-awards', 'market:Market:/analysis/overview', 'ai:AI results:/ai-review?view=analysis'],
      operations: ['overview:Overview:/status', 'sources:Sources:/sources', 'documents:Documents:/documents', 'reviews:AI reviews:/ai-review', 'runs:Runs:/runs'],
      setup: ['profiles:Profiles:/profiles', 'pipeline:AI pipeline:/workbench', 'taxonomy:Taxonomy:/taxonomy', 'data:Import & export:/settings'],
    });
  });
  it('maps every existing and new route to its section and view', () => {
    const cases: [string, string, string][] = [
      ['/', 'home', ''], ['/home', 'home', ''],
      ['/procurement', 'opportunities', 'table'], ['/procurement?view=matrix', 'opportunities', 'matrix'], ['/procurement?view=compare', 'opportunities', 'compare'],
      ['/opportunities', 'opportunities', 'table'], ['/opportunities/123', 'opportunities', 'table'],
      ['/evidence', 'opportunities', 'evidence'], ['/evidence?problem=conflict', 'opportunities', 'evidence'], ['/files', 'opportunities', 'files'], ['/files?fileStatus=failed&record=r1', 'opportunities', 'files'],
      ['/pursuits', 'pursuits', ''],
      ['/insights', 'insights', 'decisions'], ['/contract-awards', 'insights', 'awards'], ['/contract-awards/runs', 'insights', 'awards'],
      ['/analysis', 'insights', 'market'], ['/analysis/overview', 'insights', 'market'], ['/contract-awards/analysis/suppliers/x', 'insights', 'market'],
      ['/ai-review?view=analysis', 'insights', 'ai'], ['/ai-review?search=bridge&view=analysis', 'insights', 'ai'],
      ['/status', 'operations', 'overview'], ['/sources', 'operations', 'sources'], ['/scraper', 'operations', 'sources'], ['/bc-bid-dashboard', 'operations', 'sources'],
      ['/documents', 'operations', 'documents'], ['/documents?focus=extraction', 'operations', 'documents'],
      ['/ai-review', 'operations', 'reviews'], ['/ai-review?view=reviews', 'operations', 'reviews'],
      ['/runs', 'operations', 'runs'], ['/runs?kind=downloads', 'operations', 'runs'], ['/scraper/history', 'operations', 'runs'],
      ['/profiles', 'setup', 'profiles'], ['/workbench', 'setup', 'pipeline'], ['/taxonomy', 'setup', 'taxonomy'], ['/taxonomy?code=43211508', 'setup', 'taxonomy'], ['/settings', 'setup', 'data'],
    ];
    for (const [route, section, view] of cases) expect([route, sectionOf(route), viewOf(route)]).toEqual([route, section, view]);
    // Unknown paths and prefix look-alikes fall back to Operations with no view selected.
    for (const route of ['/unknown', '/opportunitiesx', '/contract-awardsx', '/filesx']) expect([route, sectionOf(route), viewOf(route)]).toEqual([route, 'operations', '']);
  });
  it('redirects a bare root to Home and keeps old root search links on the review table', () => {
    expect(redirectOf('/')).toBe('/home');
    expect(redirectOf('/?search=roof&source=bc-bid')).toBe('/procurement?search=roof&source=bc-bid&kind=all');
    expect(redirectOf('/?view=board')).toBe('/procurement?view=board');
    for (const route of ['/home', '/procurement', '/opportunities/123', '/documents', '/documents?focus=extraction', '/documents?record=r1', '/sources', '/files', '/runs', '/scraper', '/scraper/history']) expect([route, redirectOf(route)]).toEqual([route, null]);
  });
  it('redirects the retired Documents tabs and BC Bid overview, keeping their other query keys', () => {
    expect(redirectOf('/documents?tab=files')).toBe('/files');
    expect(redirectOf('/documents?tab=files&record=r1&fileStatus=failed&search=roof')).toBe('/files?record=r1&fileStatus=failed&search=roof');
    expect(redirectOf('/documents?fileStatus=extractFailed&tab=files')).toBe('/files?fileStatus=extractFailed');
    expect(redirectOf('/documents?tab=history')).toBe('/runs?kind=downloads');
    // The Zoer backend's download notification link.
    expect(redirectOf('/documents?tab=history&record=r1')).toBe('/runs?kind=downloads&record=r1');
    // The record picker's own `kind` filter cannot replace the run kind.
    expect(redirectOf('/documents?kind=award&tab=history')).toBe('/runs?kind=downloads');
    expect(redirectOf('/documents?tab=processing')).toBe('/documents?focus=extraction');
    expect(redirectOf('/documents?tab=processing&record=r1&search=roof')).toBe('/documents?focus=extraction&record=r1&search=roof');
    expect(redirectOf('/bc-bid-dashboard')).toBe('/scraper');
    expect(redirectOf('/bc-bid-dashboard?status=open&page=2')).toBe('/scraper?status=open&page=2');
    // Every target is a page that does not redirect again.
    for (const route of ['/documents?tab=files&record=r1', '/documents?tab=history', '/documents?tab=processing', '/bc-bid-dashboard?x=1']) expect(redirectOf(redirectOf(route)!)).toBeNull();
  });
  it('opens old Grid links as the Opportunities table with their filters', () => {
    expect(redirectOf('/opportunities')).toBe('/procurement?layout=table');
    const target = new URL('http://x' + redirectOf('/opportunities?search=roof&status=Open|Closed&type=RFP&sources=bc-bid|canadabuys&organization=City&buyerLevel=source&starred=1')).searchParams;
    expect(Object.fromEntries(target)).toEqual({ layout: 'table', search: 'roof', tableStatus: 'Open|Closed', tableType: 'RFP', tableSources: 'bc-bid|canadabuys', organization: 'City', buyerLevel: 'source', shortlist: '1' });
  });
  it('identifies the active opportunity view', () => {
    expect(viewOf('/procurement?view=table&queue=decide')).toBe('table');
    expect(viewOf('/procurement?view=deadlines')).toBe('table');
    // A saved record opened from an old link still belongs to the list.
    expect(viewOf('/opportunities/5')).toBe('table');
    // `view` on another opportunities page does not move its tab.
    expect(viewOf('/files?view=matrix')).toBe('files');
  });
  it('switches opportunity views without losing the filter scope', () => {
    expect(viewHref('opportunities', 'matrix', '/procurement?source=bc-bid&queue=acquire&page=3&notice=x')).toBe('/procurement?source=bc-bid&queue=acquire&view=matrix');
    expect(viewHref('opportunities', 'table', '/procurement?view=matrix&relevance=strong')).toBe('/procurement?relevance=strong');
    // Grid is gone as a view: the list keeps its presentation while moving between views.
    expect(viewHref('opportunities', 'matrix', '/procurement?layout=table&source=bc-bid')).toBe('/procurement?layout=table&source=bc-bid&view=matrix');
    expect(viewHref('opportunities', 'compare', '/opportunities')).toBe('/procurement?view=compare');
    expect(viewHref('opportunities', 'evidence', '/procurement?source=bc-bid')).toBe('/evidence');
    expect(viewHref('opportunities', 'files', '/evidence?problem=conflict')).toBe('/files');
    expect(viewHref('opportunities', 'table', '/files?fileStatus=failed')).toBe('/procurement');
    expect(viewHref('insights', 'awards', '/insights')).toBe('/contract-awards');
  });
  it('opens every other view as its own page', () => {
    // AI results and AI reviews share a page but sit in different sections, so neither carries the other's state.
    expect(viewHref('insights', 'ai', '/insights?all=1')).toBe('/ai-review?view=analysis');
    expect(viewHref('operations', 'reviews', '/runs?kind=reviews')).toBe('/ai-review');
    expect(viewHref('operations', 'runs', '/scraper/history')).toBe('/runs');
    expect(viewHref('operations', 'sources', '/scraper')).toBe('/sources');
    expect(viewHref('operations', 'documents', '/status')).toBe('/documents');
    expect(viewHref('setup', 'data', '/profiles')).toBe('/settings');
    expect(viewHref('setup', 'pipeline', '/taxonomy?code=1')).toBe('/workbench');
  });
  it('chooses the page component for shell-owned routes and defers the rest to the router', () => {
    expect(pageOf('/home')).toBe('home');
    expect(pageOf('/insights?all=1')).toBe('insights');
    expect(pageOf('/evidence')).toBe('evidence');
    expect(pageOf('/documents')).toBe('documents');
    expect(pageOf('/files?fileStatus=failed')).toBe('files');
    expect(pageOf('/runs?kind=all')).toBe('runs');
    expect(pageOf('/profiles')).toBe('profiles');
    expect(pageOf('/workbench')).toBe('workbench');
    expect(pageOf('/procurement?view=matrix')).toBe('procurement');
    for (const route of ['/opportunities', '/contract-awards', '/analysis/overview', '/bc-bid-dashboard', '/scraper', '/scraper/history']) expect(pageOf(route)).toBe('router');
  });
  it('exports the shell paths, including the new Files and Runs pages and Taxonomy', () => {
    for (const path of ['/files', '/runs', '/taxonomy', '/home', '/status', '/sources', '/documents', '/settings']) expect(SHELL_PATHS).toContain(path);
    for (const path of ['/', '/bc-bid-dashboard', '/scraper', '/scraper/history', '/contract-awards', '/analysis/overview', '/opportunities']) expect(SHELL_PATHS).not.toContain(path);
    // Every view route either is a shell page or belongs to the legacy router on purpose.
    const routerViews = Object.values(SECTION_VIEWS).flat().map(([, , to]) => to.split('?')[0]).filter(path => !SHELL_PATHS.includes(path));
    expect([...new Set(routerViews)]).toEqual(['/contract-awards', '/analysis/overview']);
  });
});
