import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { parseCapture } from '../zoer/src/capture';
const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
const listingUrl = 'https://bcbid.gov.bc.ca/page.aspx/en/rfp/request_browse_public';
const page = (html: string, url = listingUrl) => ({ html, url, title: 'BC Bid', capturedAt: '2026-09-05T22:00:00Z' });
describe('Zoer BC Bid captures', () => {
  it('reuses listing parsers and records the current-page scope and provenance', () => {
    const result = parseCapture(page(fixture('listing/page1.html')), 'listing');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]).toHaveProperty('opportunity_id');
    expect(result.document).toMatchObject({ scope: 'current-page', sourceUrl: listingUrl });
    expect(JSON.stringify(result.document)).toContain('listingUrl');
  });
  it('retains detail fields, addenda and attachments in the saved document', () => {
    const result = parseCapture(page(fixture('detail/with-addenda.html'), 'https://bcbid.gov.bc.ca/page.aspx/en/rfp/process_manage_extranet/123'), 'detail');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.document).toHaveProperty('record.addenda');
    expect(result.document).toHaveProperty('record.attachments');
  });
  it('rejects other origins and wrong pages', () => {
    expect(() => parseCapture(page('<body/>', 'https://bcbid.gov.bc.ca.evil.test/'), 'listing')).toThrow('public page');
    expect(() => parseCapture(page('<body/>', 'https://bcbid.gov.bc.ca/login'), 'listing')).toThrow('Opportunities');
    expect(() => parseCapture(page('<body/>'), 'listing')).toThrow('grid');
  });
  it('reports manual browser checks instead of a successful empty scrape', () => {
    expect(() => parseCapture(page(fixture('browser-check/browser-check.html'), 'https://bcbid.gov.bc.ca/page.aspx/en/bas/browser_check'), 'listing')).toThrow('manually');
  });
  it('allows a loaded, empty grid', () => {
    expect(parseCapture(page('<table id="body_x_grid_grd"><tbody></tbody></table>'), 'listing').rows).toEqual([]);
  });
});
