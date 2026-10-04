import { describe, expect, it } from 'vitest';
import { sourceErrorText } from '../zoer/dashboard/procurement/source-errors';
import { portalRows, readConnectorCollection } from '../zoer/dashboard/procurement/source-overview';
import { BIDSANDTENDERS_PORTALS } from '../zoer/dashboard/procurement/portals';
import { httpFailure } from '../zoer/src/connectors/errors';

describe('plain-language source errors', () => {
  it('turns the source-level portal summary into a sentence and keeps the raw code and message as detail', () => {
    expect(sourceErrorText({ code: 'portals_failed', message: '3 failed of 22 portal(s). Other portals were saved.' })).toEqual({
      text: '3 of 22 portals could not be collected. The other portals were saved; see the list below.',
      detail: 'portals_failed: 3 failed of 22 portal(s). Other portals were saved.' });
    expect(sourceErrorText({ code: 'time_budget', message: '1 failed, 2 incomplete, 4 not reached before the time limit (resume continues them) of 25 portal(s). Other portals were saved.' })!.text)
      .toBe('1 of 25 portals could not be collected, 2 were only partly collected and 4 were not reached before the time limit (the next run continues them). The other portals were saved; see the list below.');
    expect(sourceErrorText({ code: 'portals_incomplete', message: '1 incomplete of 25 portal(s). Other portals were saved.' })!.text).toBe('1 of 25 portals was only partly collected. The other portals were saved; see the list below.');
  });
  it('explains portal and CanadaBuys codes in words, with the HTTP status when there is one', () => {
    const http = httpFailure('burnaby.bidsandtenders.ca', 503);
    expect(sourceErrorText({ code: http.code, message: http.message })).toEqual({ text: 'The site did not respond normally (HTTP 503). Notices saved earlier are kept; try again later.',
      detail: 'source_http_error: burnaby.bidsandtenders.ca returned HTTP 503. Saved records are kept.' });
    expect(sourceErrorText({ code: 'source_forbidden', message: 'x returned HTTP 403.' })!.text).toMatch(/refused/);
    expect(sourceErrorText({ code: 'source_changed', message: 'The CanadaBuys snapshot changed…' })!.text).toMatch(/new daily file/);
    expect(sourceErrorText({ code: 'source_records_excluded', message: '1 notice(s) exceed the 250 kB record limit and were not saved.' })!.text).toBe('1 notice was too large to save (over 250 kB). The rest were saved.');
    expect(sourceErrorText({ code: 'source_incomplete', message: 'The portal reported 400 open notices; 7 were saved.' })!.text).toBe('The portal reports 400 open notices but listed 7; those were saved.');
    expect(sourceErrorText({ code: 'network_budget', message: 'Network request budget exhausted.' })!.text).toMatch(/request allowance/);
  });
  it('never invents a cause: unknown codes show the source message, and no error is null', () => {
    expect(sourceErrorText({ code: 'something_new', message: 'Initialize the catalog first.' })!.text).toBe('Initialize the catalog first.');
    expect(sourceErrorText({ code: 'something_new' })!.text).toBe('Collection failed (something_new).');
    expect(sourceErrorText(null)).toBeNull();
    expect(sourceErrorText({})).toBeNull();
  });
  it('portal rows carry the sentence for display and the raw text for the tooltip', () => {
    const state = readConnectorCollection({ version: 1, sourceId: 'bidsandtenders', status: 'incomplete', portals: { burnaby: { status: 'failed', error: { code: 'source_http_error', message: 'burnaby.bidsandtenders.ca returned HTTP 503. Saved records are kept.' } } } }, 'bidsandtenders');
    const row = portalRows(BIDSANDTENDERS_PORTALS, state).find(item => item.id === 'burnaby')!;
    expect(row).toMatchObject({ errorText: 'The site did not respond normally (HTTP 503). Notices saved earlier are kept; try again later.', error: 'source_http_error: burnaby.bidsandtenders.ca returned HTTP 503. Saved records are kept.' });
  });
});
