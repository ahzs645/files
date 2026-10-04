import { describe, expect, it } from 'vitest';
import { listedDocumentsText } from '../zoer/dashboard/procurement/ai';

describe('listed documents on connector notices', () => {
  it('says how many documents the source lists when none are saved here', () => {
    expect(listedDocumentsText({ documentsCount: 3, addendaCount: 1, attachments: [] }, [])).toBe('3 documents and 1 addendum listed on the source site; none saved here');
    expect(listedDocumentsText({ documentsCount: 1, addendaCount: 0 }, [])).toBe('1 document listed on the source site; none saved here');
  });
  it('defers to saved files and unknown counts', () => {
    expect(listedDocumentsText({ documentsCount: 3 }, [{ id: 'd1' }])).toBeNull();
    expect(listedDocumentsText({ documentsCount: 3, attachments: [{ url: 'https://x/a.pdf' }] }, [])).toBeNull();
    expect(listedDocumentsText({ documentsCount: 0 }, [])).toBeNull();
    expect(listedDocumentsText({}, [])).toBeNull();
  });
});
