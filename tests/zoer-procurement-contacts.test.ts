import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDetailPage } from '../packages/shared/src/parsers/detail';
import { contactsForRecord, contactsFromCanadaBuys, contactsFromDetailFields, contactsFromText, telHref } from '../zoer/dashboard/procurement/contacts';

const detail = (name: string) => parseDetailPage(readFileSync(new URL(`./fixtures/detail/${name}.html`, import.meta.url), 'utf8'), 'https://bcbid.gov.bc.ca', 'https://bcbid.gov.bc.ca/page');

describe('BC Bid detail contacts', () => {
  it('joins first/last name, email, phone and extension fields into one contact', () => {
    expect(contactsFromDetailFields([
      { label: 'Contact First Name', value: 'Jane' }, { label: 'Contact Last Name', value: 'Smith' },
      { label: 'Contact Email', value: 'jane.smith@nanaimo.ca' }, { label: 'Contact Phone', value: '(250) 555-0101' }, { label: 'Contact Phone Ext', value: '204' },
      { label: 'Status', value: 'Open' },
    ])).toEqual([{ name: 'Jane Smith', email: 'jane.smith@nanaimo.ca', phone: '(250) 555-0101 ext. 204', source: 'detail-field' }]);
  });
  it('reads the saved fixtures: a named contact, and an enquiry address but not the platform help desk', () => {
    expect(contactsForRecord(detail('with-noise'))).toEqual([{ name: 'Shawn Sheehy', source: 'detail-field' }]);
    const transit = contactsForRecord(detail('bc-transit-231457'));
    expect(transit).toEqual([{ email: 'procurement@bctransit.com', role: 'Enquiries', source: 'description' }]);
    expect(JSON.stringify(transit)).not.toMatch(/bonfire/i);
    expect(contactsForRecord(detail('without-optionals'))).toEqual([]);
  });
  it('parses a whole contact in one labelled field', () => {
    expect(contactsFromDetailFields([{ label: 'Contact', value: 'Ana Lee, Procurement Officer, ana.lee@langford.ca, 250-555-0199' }]))
      .toEqual([{ name: 'Ana Lee', email: 'ana.lee@langford.ca', phone: '250-555-0199', role: 'Procurement Officer', source: 'detail-field' }]);
  });
});

describe('description contacts', () => {
  it('takes only clearly labelled lines or question invitations', () => {
    const text = 'The City invites bids. Call us any time.\nContact: Jane Smith, Purchasing Manager, jane@city.ca, 250-555-0101\nEmail: bids@city.ca\n'
      + 'Proponents should contact Bonfire at Support@GoBonfire.com for technical questions. Questions about this tender may be sent to purchasing@langford.ca. '
      + 'Reference 2026-0001-1234. Our office at 604 555 0000 is closed Fridays. Send invoices to ap@city.ca.';
    expect(contactsFromText(text)).toEqual([
      { name: 'Jane Smith', email: 'jane@city.ca', phone: '250-555-0101', role: 'Purchasing Manager', source: 'description' },
      { email: 'bids@city.ca', source: 'description' },
      { email: 'purchasing@langford.ca', role: 'Enquiries', source: 'description' },
    ]);
  });
  it('merges the same person found twice and caps the list', () => {
    expect(contactsFromText('Contact: jane@city.ca\nEmail: JANE@city.ca')).toHaveLength(1);
    expect(contactsFromText(Array.from({ length: 9 }, (_, i) => `Email: buyer${i}@city.ca`).join('\n'))).toHaveLength(5);
  });
});

describe('CanadaBuys CSV contacts', () => {
  it('matches contactInfo columns by prefix and prefers English', () => {
    expect(contactsFromCanadaBuys({ 'contactInfoName-informationsContactNom': 'Bob Lee', 'contactInfoEmail-informationsContactCourriel': 'bob.lee@tpsgc-pwgsc.gc.ca', 'contactInfoPhone-contactInfoTelephone': '(604) 555-0199' }))
      .toEqual([{ name: 'Bob Lee', email: 'bob.lee@tpsgc-pwgsc.gc.ca', phone: '(604) 555-0199', source: 'csv' }]);
    expect(contactsFromCanadaBuys({ 'contactInfoName-eng': 'Bob', 'contactInfoName-fra': 'Robert' })).toEqual([{ name: 'Bob', source: 'csv' }]);
    expect(contactsFromCanadaBuys({ 'title-titre-eng': 'x' })).toEqual([]);
    expect(contactsForRecord({ sourceId: 'canadabuys', rawSourceData: { 'contactInfoEmail-x': 'a@b.gc.ca' }, sourceDescriptionText: 'Contact: Joe Doe, joe@b.gc.ca' }))
      .toEqual([{ email: 'a@b.gc.ca', source: 'csv' }, { name: 'Joe Doe', email: 'joe@b.gc.ca', source: 'description' }]);
  });
});

describe('telHref', () => {
  it('dials North American numbers and drops extensions', () => {
    expect(telHref('(250) 555-0101 ext. 204')).toBe('tel:+12505550101');
    expect(telHref('+1 604.555.0199')).toBe('tel:+16045550199');
    expect(telHref('555-0101')).toBeNull();
  });
});
