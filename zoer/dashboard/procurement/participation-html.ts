import { MAX_PARTICIPATION_INPUT, participationMoney, validateParticipation, type ParticipationCell, type ParticipationField, type ParticipationSection } from './participation';
import { publisherLink } from './publisher-links';

const hidden = '.x-hide-display,.x-hidden,[hidden],[aria-hidden="true"]';
const tidy = (value?: string | null) => (value ?? '').trim().replace(/\s+/gu, ' ');
const field = (id: string, label: string, type: ParticipationField['type'] = 'text', binding?: ParticipationField['binding']): ParticipationField =>
  ({ id, label, type, ...(binding ? { binding } : {}) });
function visible(element: Element | null): element is Element {
  if (!element || element.closest(hidden)) return false;
  for (let p: Element | null = element; p; p = p.parentElement) {
    if (/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(p.getAttribute('style') ?? '')) return false;
  }
  return true;
}

type GridBinding = {
  id: string; label: string; role: ParticipationSection['role']; grid: string; fields: ParticipationField[];
  empty?: string; restricted?: string; table?: boolean; unofficial?: boolean;
  read(cells: string[], row: Element, url: string): Record<string, ParticipationCell> | undefined;
};
const nameField = (label: string) => field('supplier', label, 'text', 'supplier');
const ifNamed = (supplier: string, rest: Record<string, ParticipationCell> = {}) => supplier ? { supplier, ...rest } : undefined;
const resultValue = (display?: string) => display && display !== '--' && display !== '—' ? participationMoney(display) : null;
const resultRow: GridBinding['read'] = ([supplier, , amount]) => ifNamed(supplier, { amount: resultValue(amount) });
const BIDS: GridBinding[] = [
  { id: 'plan-takers', label: 'Plan Takers', role: 'plan-takers', grid: '#dgPlanTakers', empty: '#pnlNoPlanTakers', restricted: '#PnlPlanTakersAlert',
    fields: [nameField('Company')], read: ([supplier]) => ifNamed(supplier) },
  { id: 'submitted-bids', label: 'Bids Submitted', role: 'submitted-bids', grid: '#dgSubmitted', empty: '#pnlNoSubmitted', restricted: '#PnlSubmittedAlert', unofficial: true,
    fields: [nameField('Company'), field('amount', 'Results', 'money', 'amount')], read: resultRow },
  { id: 'awards', label: 'Awarded', role: 'awards', grid: '#dgAwarded', empty: '#pnlNoAwarded', restricted: '#PnlAwardedAlert',
    fields: [nameField('Company'), field('amount', 'Results', 'money', 'amount')], read: resultRow },
  { id: 'meetings', label: 'Meeting Locations', role: 'meetings', grid: '#dgMeetingLocations', restricted: '#PnlBidMeetingsAlert',
    fields: [field('location', 'Meeting Location', 'text', 'location'), field('description', 'Description', 'text', 'description'),
      field('date-time', 'Date / Time', 'datetime', 'event-time'), field('mandatory', 'Mandatory Meeting', 'boolean', 'mandatory'),
      field('evidence', 'Meeting Document', 'url', 'evidence')],
    read: ([location, description, time, mandatory], row, url) => location && time ? {
      location, description: description || null, 'date-time': time,
      mandatory: /^yes$/i.test(mandatory) ? true : /^no$/i.test(mandatory) ? false : null,
      evidence: evidenceUrl(row.querySelectorAll('td.x-grid3-cell')[4], url),
    } : undefined },
];
const BONFIRE: GridBinding[] = [
  { id: 'document-takers', label: 'Document Takers', role: 'document-takers', grid: '#publicDocumentTakersTable', table: true,
    fields: [nameField('Vendors'), field('file-count', '# Files', 'number', 'file-count')],
    read: ([supplier, count]) => {
      const fileCount = /^\d+$/.test(count) && Number.isSafeInteger(Number(count)) ? Number(count) : null;
      return ifNamed(supplier, { 'file-count': fileCount });
    } },
  { id: 'awards', label: 'Award Notices', role: 'awards', grid: '#portalPublicAwardTable', table: true,
    fields: [nameField('Vendor'), field('awarded-at', 'Date Awarded', 'datetime', 'award-date'),
      field('amount', 'Value', 'money', 'amount'), field('evidence', 'View Award', 'url', 'evidence')],
    read: ([supplier, date, amount], row, url) => ifNamed(supplier, {
      'awarded-at': date || null, amount: resultValue(amount), evidence: evidenceUrl(row.querySelectorAll('td')[3], url),
    }) },
];

function evidenceUrl(cell: Element | undefined, base: string) {
  const href = cell?.querySelector('a[href]')?.getAttribute('href');
  if (!href || href.startsWith('#')) return null;
  try {
    const target = new URL(href, base);
    return target.origin === new URL(base).origin && !target.username && !target.password ? target.href : null;
  } catch { return null; }
}

function readGrid(markup: ParentNode, binding: GridBinding, url: string): ParticipationSection {
  const { id, label, role, fields } = binding;
  const grid = markup.querySelector(binding.grid);
  const elements = visible(grid) ? [...grid.querySelectorAll(binding.table ? 'tbody > tr' : '.x-grid3-row')].filter(visible) : [];
  const rows = elements.slice(0, 500).flatMap(row => {
    const cells = [...row.querySelectorAll(binding.table ? ':scope > td' : 'td.x-grid3-cell')].map(cell => tidy(cell.textContent));
    const data = binding.read(cells, row, url);
    return data ? [data] : [];
  });
  const restricted = !!binding.restricted && visible(markup.querySelector(binding.restricted));
  const empty = !!binding.empty && visible(markup.querySelector(binding.empty));
  const state = rows.length ? (rows.length === elements.length ? 'published' : 'incomplete') :
    restricted ? 'restricted' : empty ? 'empty' : visible(grid) ? 'incomplete' : 'not-shown';
  return { id, label, role, state, fields, rows, ...(binding.unofficial ? { unofficial: true } : {}) };
}

/** Only compiled DOM from a capture. The template stays inert and no pasted HTML is ever rendered. */
export function parseParticipationHtml(html: string, url: string, observedAt: string) {
  const link = publisherLink(url);
  if (link?.kind !== 'notice') throw Error('Choose the bids&tenders or Bonfire notice URL for this HTML.');
  if (new TextEncoder().encode(html).byteLength > MAX_PARTICIPATION_INPUT) throw Error('Choose a capture up to 1 MB.');
  const template = document.createElement('template');
  template.innerHTML = html;
  const root = template.content;
  const bids = link.label === 'bids&tenders';
  const otherVendor = bids ? !!root.querySelector('#publicDocumentTakersTable,#portalPublicAwardTable') : !!root.querySelector('#dgPlanTakers,#dgSubmitted,#dgAwarded');
  if (otherVendor) throw Error('The HTML belongs to a different publisher.');
  const header = [...root.querySelectorAll('tr')].find(row => /^bid number\s*:?$/i.test(tidy(row.querySelector('th')?.textContent)));
  const reference = bids ? tidy(header?.querySelector('td')?.textContent) : undefined;
  const sourceOrigin = new URL(link.url).origin;
  const homepage = [...root.querySelectorAll('a[href]')].find(anchor => /return to the bids homepage/i.test(tidy(anchor.textContent)))?.getAttribute('href');
  if (bids && homepage && /^https:\/\//i.test(homepage) && new URL(homepage).origin !== sourceOrigin) {
    throw Error('The capture belongs to a different buyer portal.');
  }
  const sections = (bids ? BIDS : BONFIRE).map(binding => readGrid(root, binding, link.url));
  if (sections.every(section => section.state === 'not-shown')) throw Error('No supported supplier or meeting table was found in this rendered capture.');
  return validateParticipation({ version: 1, source: { url: link.url, observedAt, ...(reference ? { reference } : {}) }, sections });
}
