import type { NoticeContact } from '../../src/connectors/types';

/**
 * Buyer contacts published with a notice. Only what the source shows: BC Bid detail fields labelled as contact,
 * email or phone; CanadaBuys contactInfo* CSV columns; and description text only where it is clearly labelled
 * ("Contact: …", "Email: …") or invites questions to an address. sbcontest2 took the first email on the page and
 * guessed a name from nearby capitalised words; that picks up platform help desks ("contact Bonfire at
 * Support@GoBonfire.com for technical questions"), so we do not.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// North American numbers, optionally with an extension; bare 7-digit or reference numbers are not phones.
const PHONE = /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|extension|x)\s*\d{1,6})?(?!\d)/gi;
const MAX_CONTACTS = 5;
const ROLE = /\b(?:manager|officer|buyer|coordinator|co-ordinator|specialist|director|analyst|lead|supervisor|agent|clerk|purchasing|procurement|engineer|administrator|consultant|advisor|technologist|superintendent)\b/i;
/** E-procurement platforms and their help desks: not the buyer. */
const PLATFORM = /(?:^|\.)(?:gobonfire\.com|bonfirehub\.(?:ca|com)|bidsandtenders\.(?:ca|com)|merx\.com|biddingo\.com|jaggaer\.com|ariba\.com|coupahost\.com|bcbid\.gov\.bc\.ca)$/i;
const isPlatformEmail = (email: string) => PLATFORM.test(email.split('@')[1] ?? '') || /^bcbid@gov\.bc\.ca$/i.test(email);

const clean = (value: unknown) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 300) : '';
const emails = (text: string) => [...new Set((text.match(EMAIL) ?? []).map(email => email.replace(/\.$/, '')))];
const phones = (text: string) => [...new Set((text.match(PHONE) ?? []).map(phone => phone.trim()))];
/** "Jane Smith" or "Jane van der Berg": 2–5 words, mostly capitalised, no digits or symbols. */
const looksLikeName = (text: string) => /^[\p{Lu}][\p{L}'.-]*(?:\s+[\p{L}'.-]+){1,4}$/u.test(text) && !/\d|@/.test(text) && text.length <= 80;

/** `tel:` target for a published number: digits only, extension dropped (shown as text instead). */
export function telHref(phone: string): string | null {
  const digits = phone.replace(/\s*(?:ext\.?|extension|x)\s*\d+$/i, '').replace(/\D/g, '');
  return digits.length === 10 ? `tel:+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `tel:+${digits}` : null;
}

function add(list: NoticeContact[], contact: NoticeContact) {
  const name = contact.name ? clean(contact.name) : '', email = contact.email ? clean(contact.email) : '';
  // Apply this to every path, including a whole "Contact" field and additional
  // addresses, rather than just standalone Email fields and description text.
  if (email && isPlatformEmail(email)) return;
  const next: NoticeContact = { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(contact.phone ? { phone: clean(contact.phone) } : {}), ...(contact.role ? { role: clean(contact.role) } : {}), source: contact.source };
  if (!next.name && !next.email && !next.phone) return;
  const digits = (value?: string) => value?.replace(/\D/g, '') ?? '';
  // Different buyers can share a switchboard. A phone match must not erase a
  // second named contact or a different published email address.
  const same = list.find(item => (next.email && item.email?.toLowerCase() === next.email.toLowerCase())
    || (next.phone && digits(item.phone) === digits(next.phone)
      && (!next.email || !item.email || next.email.toLowerCase() === item.email.toLowerCase())
      && (!next.name || !item.name || next.name.toLowerCase() === item.name.toLowerCase()))
    || (next.name && !next.email && !next.phone && item.name === next.name));
  if (same) { for (const key of ['name', 'email', 'phone', 'role'] as const) if (!same[key] && next[key]) same[key] = next[key]; return; }
  if (list.length < MAX_CONTACTS) list.push(next);
}

/** Name, email, phone and role in one labelled value: "Jane Smith, Buyer, jane@city.ca, 250-555-0101". */
function parseValue(value: string, source: NoticeContact['source'], role?: string): NoticeContact[] {
  const found = emails(value), numbers = phones(value);
  const rest = value.replace(EMAIL, ' ').replace(PHONE, ' ').replace(/\b(?:e-?mail|phone|tel(?:ephone)?|fax|cell|mobile|at|or|by)\b\s*:?/gi, ' ');
  const parts = rest.split(/[,;|()\n]|\s[-–]\s/).map(part => part.replace(/[:.\s]+$/g, '').trim()).filter(Boolean);
  const isRole = (part: string) => /^[\p{L}][\p{L}\s&/,.-]{2,60}$/u.test(part) && ROLE.test(part);
  const name = parts.find(part => looksLikeName(part) && !ROLE.test(part)), title = parts.find(part => part !== name && isRole(part));
  if (!found.length && !numbers.length && !name) return [];
  const count = Math.max(1, found.length);
  return Array.from({ length: count }, (_, i) => ({ name: i === 0 ? name : undefined, email: found[i], phone: i === 0 ? numbers[0] : undefined, role: role ?? (i === 0 ? title : undefined), source }));
}

const LABELLED = /^(?:(?:primary|procurement|purchasing|buyer|project|tender|bid)\s+)?(?:contact(?:\s+(?:person|name|info(?:rmation)?|officer|details))?|attention|attn\.?|enquiries|inquiries|questions)(?:\s+(?:to|should be directed to))?\s*[:–-]\s*(.+)$/i;
const SINGLE = /^(?:(?:contact\s+)?(?:e-?mail(?:\s+address)?|phone(?:\s+number)?|telephone|tel\.?))\s*[:–-]\s*(.+)$/i;

/** Contacts from free text: labelled lines, or a sentence inviting questions to an (non-platform) email address. */
export function contactsFromText(text: unknown, source: NoticeContact['source'] = 'description', allowUnscopedEmail = true): NoticeContact[] {
  const list: NoticeContact[] = [];
  if (typeof text !== 'string' || !text.trim()) return list;
  const segments = text.slice(0, 50_000).split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(segment => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    const labelled = segment.match(LABELLED), single = segment.match(SINGLE);
    if (labelled) for (const contact of parseValue(labelled[1], source)) { if (!contact.email || !isPlatformEmail(contact.email)) add(list, contact); }
    else if (single && (allowUnscopedEmail || /^contact\s+/i.test(segment))) {
      const found = emails(single[1]).filter(email => !isPlatformEmail(email)), phone = phones(single[1])[0];
      if (found.length) for (const [index, email] of found.entries()) add(list, { email, ...(index === 0 && phone ? { phone } : {}), source });
      else if (phone) add(list, { phone, source });
    }
    else for (const match of segment.matchAll(EMAIL)) {
      // "If you have any questions … email procurement@buyer.ca": the question words must lead to this address,
      // with no "technical"/"support" in between (that is the platform's help desk, not the buyer).
      const before = segment.slice(Math.max(0, match.index! - 160), match.index), asked = before.search(/\b(?:questions?|enquir|inquir)[a-z]*\b(?![\s\S]*\b(?:questions?|enquir|inquir))/i);
      if (asked < 0 || /\btechnical\b|\bsupport\b|\bhelp ?desk\b/i.test(before.slice(asked)) || isPlatformEmail(match[0])) continue;
      add(list, { email: match[0].replace(/\.$/, ''), phone: phones(segment.slice(match.index))[0], role: 'Enquiries', source });
    }
  }
  return list;
}

const CONTACT_LABEL = /\bcontact\b|\battention\b|\bbuyer\b|\bprocurement (?:officer|specialist|lead)\b/i;
const NON_BUYER_FIELD = /\b(?:supplier|vendor|support|help\s*desk|invoice|invoices|payment|payments)\b/i;
const SUBMISSION_FIELD = /\b(?:submission|submissions|delivery)\b/i;
const EMAIL_LABEL = /^(?:(?:primary|secondary|alternate|alternative|additional|backup|buyer|procurement|purchasing|project|tender|bid)\s+)*(?:contact(?:\s+\d+)?\s+)?e-?mail(?:\s+address)?(?:\s+\d+)?$/i;
const PHONE_LABEL = /^(?:(?:primary|secondary|alternate|alternative|additional|backup|buyer|procurement|purchasing|project|tender|bid)\s+)*(?:contact(?:\s+\d+)?\s+)?(?:phone|telephone|tel\.?)(?:\s+number)?(?:\s+(?:ext(?:ension)?\.?|\d+))?$/i;

/** A labelled secondary contact must never supply the primary person's name. */
function contactGroup(label: string): string {
  const qualifier = label.match(/\b(secondary|alternate|alternative|additional|backup)\b/i)?.[1]?.toLowerCase();
  const number = label.match(/\bcontact\s+(\d+)\b|\s(\d+)$/i);
  return qualifier ?? (number ? `contact-${number[1] ?? number[2]}` : 'primary');
}
/** BC Bid detail fields: "Contact First Name"/"Contact Last Name"/"Contact Email"/"Contact Phone", "Email", "Phone", "Contact". */
export function contactsFromDetailFields(fields: unknown): NoticeContact[] {
  const list: NoticeContact[] = [];
  if (!Array.isArray(fields)) return list;
  type ContactGroup = { contact: NoticeContact; first: string; last: string; ext: string; addresses: Array<{ email: string; priority: number }> };
  const groups = new Map<string, ContactGroup>();
  const groupFor = (label: string) => {
    const key = contactGroup(label);
    if (!groups.has(key)) groups.set(key, { contact: { source: 'detail-field' }, first: '', last: '', ext: '', addresses: [] });
    return groups.get(key)!;
  };
  const addEmail = (group: ContactGroup, email: string, priority: number) => {
    if (!isPlatformEmail(email) && !group.addresses.some(item => item.email.toLowerCase() === email.toLowerCase())) group.addresses.push({ email, priority });
  };
  for (const field of fields) {
    const label = clean(field?.label).replace(/\s*[:*]\s*$/, ''), value = clean(field?.value);
    if (!label || !value || NON_BUYER_FIELD.test(label) || SUBMISSION_FIELD.test(label)) continue;
    if (/first name/i.test(label) && CONTACT_LABEL.test(label)) groupFor(label).first ||= value;
    else if (/last name|surname/i.test(label) && CONTACT_LABEL.test(label)) groupFor(label).last ||= value;
    else if (PHONE_LABEL.test(label) && /\bext(?:ension)?\b/i.test(label)) groupFor(label).ext ||= value.replace(/\D/g, '');
    else if (EMAIL_LABEL.test(label)) {
      const group = groupFor(label);
      for (const email of emails(value)) addEmail(group, email, /\bcontact\b/i.test(label) ? 0 : 1);
    }
    else if (PHONE_LABEL.test(label)) groupFor(label).contact.phone ??= phones(value)[0];
    else if (CONTACT_LABEL.test(label) && /\b(?:name|person|contact|attention)\b/i.test(label) && value.length <= 300) {
      // A whole contact in one field, e.g. "Contact: Jane Smith, jane@city.ca".
      const group = groupFor(label), parsed = parseValue(value, 'detail-field').filter(contact => !contact.email || !isPlatformEmail(contact.email));
      const first = parsed[0];
      if (first) { group.contact.name ??= first.name ?? (looksLikeName(value) ? value : undefined); group.contact.phone ??= first.phone; group.contact.role ??= first.role; }
      for (const contact of parsed) if (contact.email) addEmail(group, contact.email, 0);
    }
  }
  for (const [, group] of [...groups.entries()].sort(([left], [right]) => Number(right === 'primary') - Number(left === 'primary'))) {
    const { contact, first, last, ext } = group;
    const name = [first, last].filter(Boolean).join(' ');
    if (name) contact.name = name;
    if (contact.phone && ext && !/ext|x\s*\d/i.test(contact.phone)) contact.phone = `${contact.phone} ext. ${ext}`;
    const addresses = group.addresses.sort((left, right) => left.priority - right.priority);
    // Extra addresses in one value do not prove that every address belongs to
    // the first named person. Keep them without manufacturing that association.
    if (addresses.length) for (const [index, { email }] of addresses.entries()) add(list, index === 0 ? { ...contact, email } : { email, source: 'detail-field' });
    else add(list, contact);
  }
  // Long free-text fields (e.g. "Delivery of Submissions") may carry a labelled contact too.
  for (const field of fields) if (typeof field?.value === 'string' && field.value.length > 80 && !NON_BUYER_FIELD.test(field.label ?? '')) {
    // An unqualified "Email:" in delivery instructions is a submission address.
    // Explicit buyer contacts and enquiry invitations can still be read there.
    for (const contact of contactsFromText(field.value, 'description', !SUBMISSION_FIELD.test(field.label ?? ''))) add(list, contact);
  }
  return list.slice(0, MAX_CONTACTS);
}

/** CanadaBuys open-data CSV: contactInfoName/Email/Phone columns (bilingual suffixes vary, so match by prefix). */
export function contactsFromCanadaBuys(raw: Record<string, string> | null | undefined): NoticeContact[] {
  if (!raw) return [];
  const column = (prefix: string) => {
    const keys = Object.keys(raw).filter(key => key.toLowerCase().startsWith(prefix));
    const preferred = keys.find(key => /-eng$/i.test(key)) ?? keys.find(key => !/-fra$/i.test(key)) ?? keys[0];
    return preferred ? clean(raw[preferred]) : '';
  };
  const name = column('contactinfoname'), emailText = column('contactinfoemail'), phoneText = column('contactinfophone');
  const email = emails(emailText)[0], phone = phones(phoneText)[0] ?? (phoneText || undefined);
  const list: NoticeContact[] = [];
  add(list, { name: name || undefined, email, phone, source: 'csv' });
  return list;
}

/** Contacts for a saved BC Bid or CanadaBuys record: structured fields first, then labelled description text. */
export function contactsForRecord(data: any): NoticeContact[] {
  const list: NoticeContact[] = [];
  const structured = data?.sourceId === 'canadabuys' ? contactsFromCanadaBuys(data?.rawSourceData) : contactsFromDetailFields(data?.detailFields);
  for (const contact of structured) add(list, contact);
  for (const contact of contactsFromText(data?.sourceDescriptionText || data?.descriptionText)) add(list, contact);
  return list;
}
