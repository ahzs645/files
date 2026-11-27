/** Portable evidence from a publisher. Source headings and cells survive the binding step. */
export const participationRoles = {
  'plan-takers': 'Plan takers',
  'document-takers': 'Document takers',
  'interested-suppliers': 'Interested suppliers',
  'prequalified-suppliers': 'Prequalified suppliers',
  'submitted-bids': 'Submitted bids',
  awards: 'Awards',
  meetings: 'Meetings',
  'prime-interest': 'Prime contractor interest',
  'subcontractor-interest': 'Subcontractor interest',
  custom: 'Custom',
} as const;
export type ParticipationRole = keyof typeof participationRoles;
export const participationTypes = ['text', 'number', 'boolean', 'date', 'datetime', 'money', 'url'] as const;
export type ParticipationType = typeof participationTypes[number];
export const participationStates = ['published', 'empty', 'restricted', 'not-shown', 'incomplete'] as const;
export type ParticipationState = typeof participationStates[number];
export const participationBindings = {
  supplier: ['text'],
  'file-count': ['number'],
  amount: ['money'],
  'event-time': ['datetime', 'date'],
  'award-date': ['datetime', 'date'],
  mandatory: ['boolean'],
  location: ['text'],
  description: ['text'],
  evidence: ['url'],
} as const;
export type ParticipationBinding = keyof typeof participationBindings;

export type Money = { display: string; decimal?: string; currency?: string };
export type ParticipationCell = string | number | boolean | Money | null;
export type ParticipationField = { id: string; label: string; type: ParticipationType; binding?: ParticipationBinding };
export type ParticipationSection = {
  id: string;
  label: string;
  role: ParticipationRole;
  state: ParticipationState;
  fields: ParticipationField[];
  rows: Record<string, ParticipationCell>[];
  unofficial?: boolean;
};
export type ParticipationSnapshot = {
  version: 1;
  source: { url: string; observedAt: string; reference?: string };
  sections: ParticipationSection[];
};
export const MAX_PARTICIPATION_INPUT = 1_000_000;

const roleAliases: Record<string, ParticipationRole> = {
  'registered plan takers': 'plan-takers',
  'public document takers': 'document-takers',
  'interested vendor list': 'interested-suppliers',
  'interested supplier list': 'interested-suppliers',
  'qualified suppliers': 'prequalified-suppliers',
  'bids submitted': 'submitted-bids',
  'unofficial bid results': 'submitted-bids',
  awarded: 'awards',
  'award notices': 'awards',
  'meeting locations': 'meetings',
  'prime gc interest': 'prime-interest',
};
const fieldAliases: Record<string, ParticipationBinding> = {
  company: 'supplier', supplier: 'supplier', vendor: 'supplier', vendors: 'supplier',
  'awarded vendor': 'supplier', 'files': 'file-count', 'file count': 'file-count',
  'number of files': 'file-count', amount: 'amount', 'bid amount': 'amount',
  'bid total': 'amount', value: 'amount', results: 'amount', 'award value': 'amount',
  'date time': 'event-time', 'date awarded': 'award-date', 'award date': 'award-date',
  'mandatory meeting': 'mandatory', mandatory: 'mandatory', location: 'location',
  'meeting location': 'location', description: 'description', 'evidence link': 'evidence',
};

const labelKey = (value: string) => value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function bindParticipationRole(label: string): ParticipationRole {
  const key = labelKey(label);
  return Object.hasOwn(roleAliases, key) ? roleAliases[key] :
    (Object.entries(participationRoles).find(([, name]) => labelKey(name) === key)?.[0] as ParticipationRole | undefined) ?? 'custom';
}
export function bindParticipationField(label: string, type: ParticipationType) {
  const key = labelKey(label);
  const binding = Object.hasOwn(fieldAliases, key) ? fieldAliases[key] : undefined;
  return binding && (participationBindings[binding] as readonly string[]).includes(type) ? binding : undefined;
}
export function participationUrl(value: unknown): string {
  let url: URL;
  try { url = new URL(typeof value === 'string' && value.length <= 2048 ? value : ''); }
  catch { throw Error('Enter a valid HTTPS source URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Enter an HTTPS URL without sign-in details or a custom port.');
  url.hash = '';
  return url.href;
}

export function participationMoney(display: string): Money {
  const parsed = /^(?:(CAD|USD|AUD|EUR|GBP)\s+)?([$£€])?\s*(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{2}))?$/u.exec(display);
  if (!parsed || (!parsed[1] && !parsed[2])) return { display };
  const currency = parsed[1] || ({ '€': 'EUR', '£': 'GBP' } as const)[parsed[2] as '€' | '£'];
  return { display, decimal: parsed[3].replaceAll(',', '') + '.' + (parsed[4] ?? '00'), ...(currency ? { currency } : {}) };
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (message: string): never => { throw Error(message); };
const oneOf = <T extends string>(value: unknown, options: readonly T[], label: string): T =>
  typeof value === 'string' && options.includes(value as T) ? value as T : fail(`Choose a supported ${label}.`);
const label = (value: unknown, max: number, name: string) =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : fail(`Enter a ${name} up to ${max} characters.`);
const key = (value: unknown, name: string) => {
  const id = label(value, 64, name);
  return /^[a-z][a-z0-9-]*$/.test(id) && id !== 'constructor' ? id : fail(`Use lowercase letters, numbers, and hyphens for each ${name}.`);
};

function cell(value: unknown, field: ParticipationField): ParticipationCell {
  if (value === null) return null;
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : fail(`${field.label} requires a number.`);
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : fail(`${field.label} requires true or false.`);
  if (field.type === 'url') return participationUrl(value);
  if (field.type === 'money') {
    if (typeof value === 'string') return participationMoney(label(value, 120, field.label));
    if (!object(value)) return fail(`${field.label} requires an amount.`);
    const display = label(value.display, 120, field.label);
    const decimal = value.decimal === undefined ? undefined : label(value.decimal, 30, 'decimal amount');
    const currency = value.currency === undefined ? undefined : label(value.currency, 3, 'currency');
    if ((decimal && !/^-?\d+(?:\.\d+)?$/.test(decimal)) || (currency && !/^[A-Z]{3}$/.test(currency))) {
      return fail(`${field.label} has an invalid decimal amount or currency.`);
    }
    return { display, ...(decimal ? { decimal } : {}), ...(currency ? { currency } : {}) };
  }
  return label(value, field.type === 'text' ? 2000 : 160, field.label);
}

function parseField(value: unknown): ParticipationField {
  if (!object(value)) return fail('Each field needs an ID, label, and type.');
  const id = key(value.id, 'field ID');
  const name = label(value.label, 100, 'field label');
  const type = oneOf(value.type, participationTypes, 'field type');
  const binding = value.binding === undefined ? bindParticipationField(name, type) :
    oneOf(value.binding, Object.keys(participationBindings) as ParticipationBinding[], 'field binding');
  if (binding && !(participationBindings[binding] as readonly string[]).includes(type)) return fail(`${name} has a binding that does not accept its field type.`);
  return { id, label: name, type, ...(binding ? { binding } : {}) };
}

function parseSection(value: unknown): ParticipationSection {
  if (!object(value)) return fail('Each section needs an ID, label, state, fields, and rows.');
  const id = key(value.id, 'section ID');
  const name = label(value.label, 140, 'section label');
  const role = value.role === undefined ? bindParticipationRole(name) :
    oneOf(value.role, Object.keys(participationRoles) as ParticipationRole[], 'section role');
  const state = oneOf(value.state, participationStates, 'publication state');
  if (!Array.isArray(value.fields) || value.fields.length > 20 || !Array.isArray(value.rows) || value.rows.length > 500) {
    return fail('Each section supports up to 20 fields and 500 rows.');
  }
  const fields = value.fields.map(parseField);
  const ids = new Set(fields.map(field => field.id));
  if (ids.size !== fields.length) return fail('Field IDs must be unique within a section.');
  if ((value.rows.length && (!ids.size || (state !== 'published' && state !== 'incomplete'))) || (!value.rows.length && state === 'published')) {
    return fail('A published section needs rows. Use the empty, restricted, not-shown, or incomplete state when appropriate.');
  }
  const rows = value.rows.map((row) => {
    if (!object(row) || !Object.keys(row).length || Object.keys(row).some(id => !ids.has(id))) {
      return fail('Every row must use field IDs declared in its section.');
    }
    return Object.fromEntries(fields.filter(field => Object.hasOwn(row, field.id)).map(field => [field.id, cell(row[field.id], field)]));
  });
  return { id, label: name, role, state, fields, rows, ...(value.unofficial === true ? { unofficial: true } : {}) };
}

export function validateParticipation(value: unknown): ParticipationSnapshot {
  if (!object(value) || value.version !== 1 || !object(value.source) || !Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 24) {
    return fail('Use version 1 supplier evidence with a source and 1 to 24 sections.');
  }
  const url = participationUrl(value.source.url);
  const observedAt = label(value.source.observedAt, 40, 'observation timestamp');
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) {
    return fail('The observation timestamp needs an ISO date, time, and time zone.');
  }
  const reference = value.source.reference === undefined ? undefined : label(value.source.reference, 140, 'solicitation reference');
  const sections = value.sections.map(parseSection);
  if (new Set(sections.map(section => section.id)).size !== sections.length) return fail('Section IDs must be unique within a snapshot.');
  const snapshot: ParticipationSnapshot = { version: 1, source: { url, observedAt: new Date(observedAt).toISOString(), ...(reference ? { reference } : {}) }, sections };
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > MAX_PARTICIPATION_INPUT) return fail('Supplier evidence exceeds 1 MB.');
  return snapshot;
}

export function formatParticipationCell(value: ParticipationCell | undefined) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'object' ? value.display : String(value);
}
