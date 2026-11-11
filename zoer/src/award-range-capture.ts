import * as cheerio from 'cheerio';
import { parseAwardPage, AWARDS_URL } from './award-history';
import type { PageCapture } from './capture';
import { awardSearchUpperBound, type AwardRangeCapture } from './award-ranges';

// Observed on BC Bid's public Contract Awards form, 2026-09-14.
export const AWARD_DATE_FIELDS = { from: '#body_x_txtCtrEffectiveDate', to: '#body_x_txtCtrEffectiveDatemax' };

/** Bind only to public date fields verified on the source; no arbitrary URL. */
export function awardRangeCapture(
  capture: (options: any) => Promise<PageCapture>,
  fields: { from: string; to: string },
) {
  for (const selector of [fields.from, fields.to]) if (!/^#[A-Za-z][A-Za-z0-9_-]{0,150}$/.test(selector)) throw new Error('Invalid public award date control.');
  if (fields.from === fields.to) throw new Error('Award date controls must be distinct.');
  return async (request: AwardRangeCapture) => {
    const upper = awardSearchUpperBound(request.range.to);
    const searchFields = [{ selector: fields.from, value: request.range.from }];
    if (upper) searchFields.push({ selector: fields.to, value: upper });
    const options = {
      url: AWARDS_URL,
      searchFields,
      ...(request.reread ? {} : request.applySearch ? { pageNumber: 1, applySearch: true } : { continuePage: request.page }),
    };
    const page = await capture(options);
    // Validate public origin and schema before the range worker considers empty
    // results or completion. Host verifies the actual input values after search.
    parseAwardPage(page, { allowEmpty: true });
    const $ = cheerio.load(page.html);
    const applied = (bound: 'min' | 'max') => $('.iv-filter-summary .tag-label').toArray().filter(node => $(node).text().replace(/\s+/g, ' ').trim() === `Award Date (${bound}) :`).map(node => $(node).next('ul').find('.tag-text').text().trim());
    const maximum = applied('max');
    if (applied('min').length !== 1 || applied('min')[0] !== request.range.from ||
      (upper ? maximum.length !== 1 || maximum[0] !== upper : maximum.length !== 0)) {
      throw new Error('BC Bid did not confirm the award date filters. History remains incomplete.');
    }
    return page;
  };
}
