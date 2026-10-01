import { describe, it, expect } from 'vitest';
import { CONFIGURE_SECTIONS, PRIMARY_SECTIONS, pageOf, redirectOf, sectionOf, viewHref, viewOf } from '../zoer/dashboard/review-workspace/nav';

describe('review workspace navigation', () => {
  it('has six primary sections and a separate Configure group', () => {
    expect(PRIMARY_SECTIONS.map(([id]) => id)).toEqual(['home', 'opportunities', 'pursuits', 'documents', 'evidence', 'insights']);
    expect(CONFIGURE_SECTIONS.map(([id]) => id)).toEqual(['workbench', 'profiles', 'sources']);
    // Phones keep short labels where the long ones would not fit.
    expect(PRIMARY_SECTIONS.find(([id]) => id === 'opportunities')?.[3]).toBe('Opps');
    expect(PRIMARY_SECTIONS.find(([id]) => id === 'documents')?.[3]).toBe('Docs');
    expect(CONFIGURE_SECTIONS.find(([id]) => id === 'workbench')?.[3]).toBe('AI');
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
    expect(redirectOf('/?search=roof&source=bc-bid')).toBe('/procurement?search=roof&source=bc-bid');
    expect(redirectOf('/?view=board')).toBe('/procurement?view=board');
    for (const route of ['/home', '/procurement', '/opportunities', '/documents', '/sources']) expect(redirectOf(route)).toBeNull();
  });
  it('identifies the active view inside a section', () => {
    expect(viewOf('/procurement')).toBe('table');
    expect(viewOf('/procurement?view=table&queue=decide')).toBe('table');
    expect(viewOf('/procurement?view=matrix')).toBe('matrix');
    expect(viewOf('/procurement?view=compare')).toBe('compare');
    expect(viewOf('/procurement?view=deadlines')).toBe('table');
    expect(viewOf('/opportunities/5')).toBe('grid');
    // Evidence and Documents are single-view sections.
    expect(viewOf('/evidence')).toBe('');
    expect(viewOf('/documents')).toBe('');
    expect(viewOf('/insights')).toBe('decisions');
    expect(viewOf('/analysis/sources')).toBe('market');
    expect(viewOf('/contract-awards/analysis/organizations/a')).toBe('market');
    expect(viewOf('/contract-awards')).toBe('awards');
    expect(viewOf('/workbench')).toBe('stages');
    expect(viewOf('/ai-review')).toBe('reviews');
    expect(viewOf('/pursuits')).toBe('');
  });
  it('switches opportunity views without losing the filter scope', () => {
    expect(viewHref('opportunities', 'matrix', '/procurement?source=bc-bid&queue=acquire&page=3&notice=x')).toBe('/procurement?source=bc-bid&queue=acquire&view=matrix');
    expect(viewHref('opportunities', 'table', '/procurement?view=matrix&relevance=strong')).toBe('/procurement?relevance=strong');
    expect(viewHref('opportunities', 'grid', '/procurement?source=bc-bid')).toBe('/opportunities');
    expect(viewHref('opportunities', 'compare', '/opportunities')).toBe('/procurement?view=compare');
    expect(viewHref('insights', 'awards', '/insights')).toBe('/contract-awards');
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
