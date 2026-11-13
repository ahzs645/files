import { describe, expect, it } from 'vitest';
import { attachmentsAccess, cleanAttachments, isPlaceholderClosing, mergeAttachments, normalizePlaceholderClosing } from '../zoer/src/connectors/attachments';

describe('attachment links (CONTRACT2 shape 1)', () => {
  it('keeps named https links once each, with size and login marks', () => {
    expect(cleanAttachments([{ name: ' A  file ', url: 'https://x.ca/a.pdf', size: 10 }, { name: 'dup', url: 'https://x.ca/a.pdf' }, { name: 'bad', url: 'http://x.ca/b.pdf' },
      { name: '', url: 'https://x.ca/docs/Plan%20B.pdf', access: 'login' }, { name: 'x', url: 'https://user:pw@x.ca/c.pdf' }, undefined]))
      .toEqual([{ name: 'A file', url: 'https://x.ca/a.pdf', size: 10 }, { name: 'Plan B.pdf', url: 'https://x.ca/docs/Plan%20B.pdf', access: 'login' }]);
  });
  it('summarises access', () => {
    expect(attachmentsAccess([])).toBeUndefined();
    expect(attachmentsAccess([{ url: 'a' }])).toBe('public');
    expect(attachmentsAccess([{ url: 'a', access: 'login' }])).toBe('login');
    expect(attachmentsAccess([{ url: 'a', access: 'login' }, { url: 'b' }])).toBe('mixed');
  });
  it('takes the source\'s current list, keeps saved fields of the same link, and keeps the saved list when the source gives none', () => {
    const saved = [{ name: 'Old', url: 'https://x.ca/a.pdf', size: 5, documentId: 'd1', access: 'login' }, { name: 'Gone', url: 'https://x.ca/gone.pdf' }];
    expect(mergeAttachments([{ name: 'New', url: 'https://x.ca/a.pdf' }], saved)).toEqual([{ name: 'New', url: 'https://x.ca/a.pdf', size: 5, documentId: 'd1' }]);
    expect(mergeAttachments([], saved)).toEqual(saved);
    expect(mergeAttachments([], saved)).not.toBe(saved);
    expect(mergeAttachments(undefined, undefined)).toEqual([]);
  });
  it('treats closing dates after 2035 as placeholders', () => {
    expect(isPlaceholderClosing({ closingDate: '2074-12-31T14:00:00' })).toBe(true);
    expect(isPlaceholderClosing({ closingDate: 'Dec 31, 2035', closingAt: '2035-12-31' })).toBe(false);
    expect(isPlaceholderClosing({ closingDate: '', closingAt: '2100-01-01T00:00:00-05:00' })).toBe(true);
    expect(normalizePlaceholderClosing({ closingDate: '2100-12-31T14:00:00', closingAt: '2100-12-31T14:00:00-05:00' }))
      .toEqual({ closingDate: null, closingDateRaw: '2100-12-31T14:00:00', closingAt: undefined, closingDatePlaceholder: true });
    expect(JSON.parse(JSON.stringify(normalizePlaceholderClosing({ closingDate: '2026-12-01' })))).toEqual({ closingDate: '2026-12-01' });
  });
});
