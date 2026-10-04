import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { MUNICIPALITIES, REGIONAL_DISTRICTS } from '../zoer/dashboard/procurement/place-data';
import { BC_MUNICIPALITIES, BC_REGIONAL_DISTRICTS, findPlaces, tagPlace } from '../zoer/dashboard/procurement/places';
import { ENRICHMENT_KEY, ENRICHMENT_VERSION, enrichNotice, enrichmentChanged } from '../zoer/dashboard/procurement/enrich';
import { buildProcurementQuery } from '../zoer/dashboard/procurement/catalog';
import { PLACE_OPTIONS_SQL, placeOptions } from '../zoer/dashboard/procurement/places';
import { backfillEnrichment } from '../zoer/src/procurement-enrichment';
import { saveCatalogDocument } from '../zoer/src/catalog';
import { parseCanadaBuysCsv } from '../zoer/dashboard/procurement/import-canadabuys';

const at = (buyer: string) => { const place = tagPlace({ buyer }); return place && [place.municipality, place.regionalDistrict]; };
const inText = (text: string, requireBcInText = false) => { const place = tagPlace({ text, requireBcInText }); return place && [place.municipality, place.regionalDistrict]; };

describe('BC place data (BC Data Catalogue ABMS, 2026-10-03)', () => {
  it('has every municipality with a known regional district and all 27 regional districts', () => {
    expect(MUNICIPALITIES).toHaveLength(160);
    expect(REGIONAL_DISTRICTS).toHaveLength(27);
    const ids = new Set(REGIONAL_DISTRICTS.map(rd => rd.id));
    for (const [, rd] of MUNICIPALITIES) if (rd !== null) expect(ids.has(rd)).toBe(true);
    expect(MUNICIPALITIES.filter(([, rd]) => rd === null).map(([name]) => name)).toEqual(['Northern Rockies']);
    expect(BC_MUNICIPALITIES.get('Nanaimo')).toBe('Regional District of Nanaimo');
    expect(BC_MUNICIPALITIES.get('Prince George')).toBe('Regional District of Fraser-Fort George');
    expect(BC_REGIONAL_DISTRICTS).toContain('qathet Regional District');
  });
  it('tags every municipality from its legal name and every regional district from its own name', () => {
    for (const [name, , legal] of MUNICIPALITIES) expect([legal, at(legal)?.[0]]).toEqual([legal, name]);
    for (const rd of REGIONAL_DISTRICTS) expect(at(rd.name)).toEqual([null, rd.name]);
  });
});

describe('tagPlace', () => {
  it('reads common buyer spellings, longest name first', () => {
    expect(at('City of Nanaimo')).toEqual(['Nanaimo', 'Regional District of Nanaimo']);
    expect(at('Nanaimo, City of')).toEqual(['Nanaimo', 'Regional District of Nanaimo']);
    expect(at('CITY OF PORT COQUITLAM')).toEqual(['Port Coquitlam', 'Metro Vancouver Regional District']);
    expect(at('City of West Kelowna')).toEqual(['West Kelowna', 'Regional District of Central Okanagan']);
    expect(at('Fort St John')).toEqual(['Fort St. John', 'Peace River Regional District']);
    expect(at('Fort Saint James Public Works')).toEqual(['Fort St. James', 'Regional District of Bulkley-Nechako']);
    expect(at('District of Hudson’s Hope')).toEqual(["Hudson's Hope", 'Peace River Regional District']);
    expect(at('RD of Nanaimo')).toEqual([null, 'Regional District of Nanaimo']);
    expect(at('Thompson Nicola Regional District')).toEqual([null, 'Thompson-Nicola Regional District']);
    expect(at('Powell River Regional District')).toEqual([null, 'qathet Regional District']);
    expect(at('RDCO')).toEqual([null, 'Regional District of Central Okanagan']);
    expect(at('Greater Vancouver Water District')).toEqual([null, 'Metro Vancouver Regional District']);
  });
  it('splits shared names by their qualifier and otherwise gives only the shared regional district', () => {
    expect(at('City of Langley')).toEqual(['Langley (City)', 'Metro Vancouver Regional District']);
    expect(at('Township of Langley')).toEqual(['Langley (Township)', 'Metro Vancouver Regional District']);
    expect(at('Langley School District')).toEqual([null, 'Metro Vancouver Regional District']);
    expect(at('The Corporation of the District of North Vancouver')).toEqual(['North Vancouver (District)', 'Metro Vancouver Regional District']);
    expect(at('North Vancouver Recreation')).toEqual([null, 'Metro Vancouver Regional District']);
  });
  it('needs a qualifier for names that are also words or surnames', () => {
    for (const buyer of ['Mission Support Services', 'Golden Ears Holdings', 'Hope Air', 'Delta Controls Inc.', 'Trail Appliances', 'Nelson Education', 'Houston Engineering']) expect(at(buyer)).toBeNull();
    expect(at('City of Mission')).toEqual(['Mission', 'Fraser Valley Regional District']);
    expect(at('Town of Golden')).toEqual(['Golden', 'Columbia Shuswap Regional District']);
    expect(inText('Site visit in Hope, BC on Monday')).toEqual(['Hope', 'Fraser Valley Regional District']);
    expect(inText('mission critical work on the golden trail')).toBeNull();
  });
  it('never matches Central, Peace River, Fraser Valley or Cariboo on their own', () => {
    for (const text of ['Central heating plant', 'Peace River crossing', 'Fraser Valley Regional Library', 'Cariboo region gravel', 'Capital project']) expect(inText(text)).toBeNull();
    expect(at('Cariboo Regional District')).toEqual([null, 'Cariboo Regional District']);
  });
  it('ignores places that are not the place: Vancouver Island, First Nations, roads, other provinces', () => {
    expect(at('Vancouver Island University')).toBeNull();
    expect(at('Vancouver Coastal Health')).toBeNull();
    expect(at('Squamish Nation')).toBeNull();
    expect(at('Westbank First Nation')).toBeNull();
    expect(inText('Paving on Nanaimo Rd and Victoria Rd')).toBeNull();
    expect(inText('Office in Richmond Hill, Ontario')).toBeNull();
    expect(at('Nanaimo RD')).toEqual([null, 'Regional District of Nanaimo']);
  });
  it('gives the shared regional district for several municipalities and nothing across districts', () => {
    expect(inText('Services in Victoria, Saanich and Oak Bay')).toEqual([null, 'Capital Regional District']);
    expect(inText('Services in Victoria and Kelowna')).toBeNull();
    expect(inText('Regional District of Nanaimo landfill near the City of Nanaimo')).toEqual(['Nanaimo', 'Regional District of Nanaimo']);
  });
  it('uses school district numbers, communities and the method order buyer → region → text', () => {
    expect(at('School District No. 61 (Greater Victoria)')).toEqual([null, 'Capital Regional District']);
    expect(at('School District #39 (Vancouver)')).toEqual(['Vancouver', 'Metro Vancouver Regional District']);
    expect(at('SD 20 Kootenay-Columbia')).toBeNull(); // spans two regional districts and its name is not a place
    expect(inText('Cobble Hill hall roof')).toEqual([null, 'Cowichan Valley Regional District']);
    expect(inText('Chemainus water main')).toEqual(['North Cowichan', 'Cowichan Valley Regional District']);
    expect(tagPlace({ buyer: 'City of Kamloops', text: 'Work in Kelowna' })).toMatchObject({ municipality: 'Kamloops', method: 'buyer' });
    expect(tagPlace({ buyer: 'Ministry of Transportation and Transit', region: 'Prince George', text: 'Work in Kelowna' })).toMatchObject({ municipality: 'Prince George', method: 'source-region' });
    expect(tagPlace({ buyer: 'BC Housing', text: ['Repairs, Kelowna', 'Full description'] })).toMatchObject({ municipality: 'Kelowna', method: 'description' });
  });
  it('for CanadaBuys outside a BC delivery region, counts only "<place>, BC" forms', () => {
    expect(inText('Office in Kelowna', true)).toBeNull();
    expect(inText('Office in Kelowna, B.C.', true)).toEqual(['Kelowna', 'Regional District of Central Okanagan']);
    expect(inText('Esquimalt British Columbia dockyard', true)).toEqual(['Esquimalt', 'Capital Regional District']);
  });
  it('is fast enough for ingest batches', () => {
    const text = 'The City of Nanaimo invites proposals for road paving in the Harewood area. '.repeat(40);
    const started = performance.now();
    for (let i = 0; i < 500; i++) findPlaces(text, { caseSensitiveBare: true });
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('enrichNotice', () => {
  const bcBid = { sourceKey: '1', description: 'Bowen Road paving', issuedBy: 'City of Nanaimo', detailFields: [{ label: 'Contact Email', value: 'purchasing@nanaimo.ca' }] };
  it('sets place, contacts and an empty region, and is idempotent', () => {
    const once = enrichNotice(bcBid);
    expect(once.place).toEqual({ municipality: 'Nanaimo', regionalDistrict: 'Regional District of Nanaimo', method: 'buyer' });
    expect(once.contacts).toEqual([{ email: 'purchasing@nanaimo.ca', source: 'detail-field' }]);
    expect(once).toMatchObject({ region: 'Nanaimo', regionFromPlace: true });
    expect(enrichNotice(once)).toEqual(once);
    expect(enrichmentChanged(once)).toBe(false);
    expect(enrichmentChanged(bcBid)).toBe(true);
  });
  it('keeps a source region, replaces a region it filled, and leaves other sources alone', () => {
    expect(enrichNotice({ ...bcBid, region: 'Vancouver Island' }).region).toBe('Vancouver Island');
    const retagged = enrichNotice({ ...enrichNotice(bcBid), issuedBy: 'BC Housing', description: 'Roof' });
    expect(retagged.place).toBeUndefined();
    expect(retagged.region).toBeUndefined();
    expect(retagged.regionFromPlace).toBeUndefined();
    const connector = { sourceId: 'bidsandtenders', issuedBy: 'City of Nanaimo', place: { municipality: 'Nanaimo', regionalDistrict: 'Regional District of Nanaimo', method: 'portal' } };
    expect(enrichNotice(connector)).toBe(connector);
  });
  it('tags CanadaBuys notices only for BC delivery or a "<place>, BC" mention, and reads CSV contacts', () => {
    const header = 'referenceNumber-numeroReference,title-titre-eng,tenderStatus-appelOffresStatut-eng,tenderClosingDate-appelOffresDateCloture,contractingEntityName-nomEntitContractante-eng,regionsOfDelivery-regionsLivraison-eng,tenderDescription-descriptionAppelOffres-eng,contactInfoName-informationsContactNom,contactInfoEmail-informationsContactCourriel,contactInfoPhone-contactInfoTelephone';
    const rows = ['A,Dock repairs,Open,2026-10-01T14:00:00,Fisheries and Oceans Canada,British Columbia,Work at the Nanaimo small craft harbour,Jane Roe,jane.roe@dfo-mpo.gc.ca,250-555-0100',
      'B,Office cleaning,Open,2026-10-01T14:00:00,Public Services and Procurement Canada,Ontario,Cleaning in Richmond and Victoria,,,',
      'C,Survey,Open,2026-10-01T14:00:00,Parks Canada,"Alberta, British Columbia",Survey work near Revelstoke,,,'];
    const { records } = parseCanadaBuysCsv([header, ...rows].join('\n'), { fileName: 'x.csv', sha256: 'h', importedAt: '2026-10-03T00:00:00Z' });
    const [a, b, c] = records.map(record => enrichNotice(record));
    expect(a.place).toEqual({ municipality: 'Nanaimo', regionalDistrict: 'Regional District of Nanaimo', method: 'description' });
    expect(a.contacts).toEqual([{ name: 'Jane Roe', email: 'jane.roe@dfo-mpo.gc.ca', phone: '250-555-0100', source: 'csv' }]);
    expect(a.region).toBe('British Columbia');
    expect(b.place).toBeUndefined();
    expect(c.place).toMatchObject({ municipality: 'Revelstoke' });
  });
  it('cleans bulleted CanadaBuys regions at import and in the backfill, keeping the source value in rawSourceData', () => {
    const header = 'referenceNumber-numeroReference,title-titre-eng,tenderStatus-appelOffresStatut-eng,tenderClosingDate-appelOffresDateCloture,contractingEntityName-nomEntitContractante-eng,regionsOfDelivery-regionsLivraison-eng';
    const { records: [record] } = parseCanadaBuysCsv([header, 'R,Survey,Open,2026-10-01T14:00:00,Parks Canada,"*British Columbia\n*Alberta\n"'].join('\n'), { fileName: 'x.csv', sha256: 'h', importedAt: '2026-10-03T00:00:00Z' });
    expect(record.region).toBe('British Columbia, Alberta');
    expect(record.rawSourceData['regionsOfDelivery-regionsLivraison-eng']).toBe('*British Columbia\n*Alberta\n');
    expect(record.sourceFields).toContainEqual({ label: 'Regions', value: 'British Columbia, Alberta' });
    const saved = { sourceId: 'canadabuys', description: 'Survey', issuedBy: 'Parks Canada', region: '*British Columbia\n*Alberta', sourceFields: [{ label: 'Regions', value: '*British Columbia\n*Alberta' }], detailFields: [{ label: 'Regions', value: '*British Columbia\n*Alberta' }] };
    expect(enrichmentChanged(saved)).toBe(true);
    expect(enrichNotice(saved)).toMatchObject({ region: 'British Columbia, Alberta', sourceFields: [{ label: 'Regions', value: 'British Columbia, Alberta' }], detailFields: [{ label: 'Regions', value: 'British Columbia, Alberta' }] });
    expect(enrichmentChanged(enrichNotice(saved))).toBe(false);
    // Other sources' region text is never rewritten.
    expect(enrichNotice({ sourceId: 'bc-bid', description: 'x', region: '*Odd' }).region).toBe('*Odd');
  });
  it('is applied when BC Bid listings and details are saved', async () => {
    const records = new Map<string, any>([['opportunity:9', { id: 'opportunity:9', kind: 'opportunity', title: 'Old', data: { sourceKey: '9', processId: '9', description: 'Old', issuedBy: 'City of Courtenay' } }]]);
    let revision = 1;
    const host = async (method: string, input: any): Promise<any> => {
      if (method === 'catalog.read') return input.match ? { revision, records: [...records.values()].filter(row => row.data.processId === input.match.value) } : { primary: true, revision, records: (input.ids ?? []).map((id: string) => records.get(id)).filter(Boolean) };
      if (method === 'catalog.workspace') return { revision, entries: [] };
      if (method === 'catalog.commit') { for (const row of input.records) records.set(row.id, row); return { revision: ++revision }; }
      throw Error(method);
    };
    await saveCatalogDocument(host, { kind: 'listing', records: [{ sourceKey: '9', processId: '9', description: 'Arena roof', issuedBy: 'City of Courtenay' }] }, 'run-1');
    expect(records.get('opportunity:9').data.place).toMatchObject({ municipality: 'Courtenay', method: 'buyer' });
    await saveCatalogDocument(host, { kind: 'detail', record: { processId: '9', detailFields: [{ label: 'Contact First Name', value: 'Ana' }, { label: 'Contact Last Name', value: 'Lee' }, { label: 'Contact Phone', value: '250-555-0123' }] } }, 'run-2');
    expect(records.get('opportunity:9').data.contacts).toEqual([{ name: 'Ana Lee', phone: '250-555-0123', source: 'detail-field' }]);
  });
});

describe('place filter SQL', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,title TEXT NOT NULL,data TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?)');
  const add = (id: string, data: any, kind = 'opportunity') => insert.run(id, kind, id, JSON.stringify({ description: id, ...data }), 'h', '2026-10-01');
  add('a', enrichNotice({ issuedBy: 'City of Nanaimo' }));
  add('b', enrichNotice({ issuedBy: 'District of Lantzville' }));
  add('c', enrichNotice({ issuedBy: 'Regional District of Nanaimo' }));
  add('d', enrichNotice({ issuedBy: 'City of Kamloops' }));
  add('e', { issuedBy: 'BC Housing' });
  // The host runner wraps every plugin statement this way, after the same validator.
  const read = (statement: string, parameters: (string | number)[] = []) => { validateCatalogSelect(statement, parameters); return db.prepare(`SELECT * FROM (${statement}) LIMIT 201`).all(...parameters) as any[]; };
  it('filters by municipality or regional district through the host validator', () => {
    const ids = (place: string) => { const q = buildProcurementQuery({ place, sort: 'updated' }); return read(q.statement, q.parameters).map(row => row.id).sort(); };
    expect(ids('m:Nanaimo')).toEqual(['a']);
    expect(ids('rd:Regional District of Nanaimo')).toEqual(['a', 'b', 'c']);
    expect(ids('rd:Thompson-Nicola Regional District')).toEqual(['d']);
    expect(ids('nonsense')).toEqual(['a', 'b', 'c', 'd', 'e']);
    const q = buildProcurementQuery({ place: 'm:Nanaimo' });
    expect(read(q.countStatement, q.countParameters)[0].total).toBe(1);
  });
  it('lists place options with counts, districts summed', () => {
    const options = placeOptions(read(PLACE_OPTIONS_SQL));
    expect(options).toContainEqual({ value: 'rd:Regional District of Nanaimo', label: 'Regional District of Nanaimo · 3', description: 'Whole regional district' });
    expect(options).toContainEqual({ value: 'm:Lantzville', label: 'Lantzville · 1', description: 'Regional District of Nanaimo' });
    expect(options.some(option => option.value === 'm:null')).toBe(false);
  });
});

describe('procurement.enrich backfill', () => {
  function catalog(count: number) {
    let revision = 1;
    const records = new Map<string, any>(), states = new Map<string, any>(), commits: any[] = [];
    for (let i = 0; i < count; i++) {
      const id = `opportunity:${String(i).padStart(4, '0')}`;
      records.set(id, { id, kind: 'opportunity', title: `Notice ${i}`, data: { sourceKey: String(i), description: `Notice ${i}`, issuedBy: i % 3 === 0 ? 'City of Victoria' : i % 3 === 1 ? 'BC Housing' : 'City of Prince George', starred: i === 4 } });
    }
    records.set('award:x', { id: 'award:x', kind: 'award', title: 'Award', data: { issuedBy: 'City of Victoria' } });
    const mock = { records, states, commits, conflictOnce: false,
      host: async (method: string, input: any): Promise<any> => {
        if (input.revision !== undefined && input.revision !== revision && method !== 'catalog.commit') throw Error('Catalog changed; reload the snapshot.');
        if (method === 'catalog.read') {
          if (input.ids) return { primary: true, revision, records: [] };
          const rows = [...records.values()].filter(row => row.kind === input.kind && row.id > input.after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, input.limit);
          return { primary: true, revision, records: structuredClone(rows), next: rows.at(-1)?.id ?? null };
        }
        if (method === 'catalog.workspace') return { revision, entries: [...states].filter(([key]) => input.keys.includes(key)).map(([key, value]) => ({ key, value: structuredClone(value) })) };
        if (method === 'catalog.commit') {
          if (mock.conflictOnce) { mock.conflictOnce = false; revision++; return { conflict: true }; }
          if (input.revision !== revision) return { conflict: true };
          for (const row of input.records) records.set(row.id, structuredClone(row));
          for (const entry of input.entries) states.set(entry.key, structuredClone(entry.value));
          commits.push(structuredClone(input)); return { revision: ++revision };
        }
        throw Error(method);
      } };
    return mock;
  }
  it('tags every opportunity in resumable batches, writes only changed rows, and is idempotent', async () => {
    const db = catalog(120);
    const first = await backfillEnrichment(db.host, { maxBatches: 2 }, 'run-1');
    expect(first).toMatchObject({ processed: 100, complete: false });
    expect(db.states.get(ENRICHMENT_KEY)).toMatchObject({ cursor: 'opportunity:0099', complete: false, enrichmentVersion: ENRICHMENT_VERSION });
    db.conflictOnce = true;
    const second = await backfillEnrichment(db.host, {}, 'run-2');
    expect(second).toMatchObject({ processed: 20, complete: true, totalProcessed: 120, totalUpdated: 80 });
    expect(db.records.get('opportunity:0000').data.place).toMatchObject({ municipality: 'Victoria' });
    expect(db.records.get('opportunity:0001').data.place).toBeUndefined();
    expect(db.records.get('opportunity:0004').data.starred).toBe(true);
    expect(db.records.get('award:x').data.place).toBeUndefined();
    // Every commit keeps its records and the cursor together, and no unchanged row was rewritten.
    for (const commit of db.commits) expect(commit.records.every((row: any) => row.data.place)).toBe(true);
    const again = await backfillEnrichment(db.host, {}, 'run-3');
    expect(again).toMatchObject({ processed: 120, updated: 0, complete: true });
  });
  it('rejects invalid input', async () => {
    await expect(backfillEnrichment(catalog(1).host, { maxBatches: 0 }, 'r')).rejects.toThrow('Invalid enrichment request.');
    await expect(backfillEnrichment(catalog(1).host, { mode: 'all' as any }, 'r')).rejects.toThrow('Invalid enrichment request.');
  });
});

describe('connector portal places', () => {
  it('use the same municipality and regional district names as tagged notices, so one Place option covers both', async () => {
    const { BIDSANDTENDERS_PORTALS } = await import('../zoer/dashboard/procurement/portals');
    const { SITE_PORTALS } = await import('../zoer/dashboard/procurement/site-portals');
    for (const { id, place } of [...BIDSANDTENDERS_PORTALS, ...SITE_PORTALS]) {
      if (place.regionalDistrict) expect(BC_REGIONAL_DISTRICTS, id).toContain(place.regionalDistrict);
      if (place.municipality) expect(BC_MUNICIPALITIES.get(place.municipality), id).toBe(place.regionalDistrict);
    }
    const nanaimo = BIDSANDTENDERS_PORTALS.find(portal => portal.id === 'nanaimo')!;
    expect(tagPlace({ buyer: 'City of Nanaimo' })).toEqual({ ...nanaimo.place, method: 'buyer' });
  });
});
