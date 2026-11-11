import { describe, it, expect } from 'vitest';
import { newAwardRanges, scrapeAwardRanges, splitAwardRange, validateAwardRanges } from '../zoer/src/award-ranges';
import { AWARDS_URL } from '../zoer/src/award-history';
const page = (number = 1, last = 1, id = 'A', awardDate = '2026-01-01') => ({ url: AWARDS_URL, title: 'Awards', capturedAt: '2026-09-14T00:00:00Z', pagination: { currentPage: number, hasNext: number < last, visiblePages: [number] }, html: `<table id="body_x_grid_grd"><thead><tr><th>Opportunity ID</th><th>Opportunity Description</th><th>Successful Supplier</th><th>Award Date</th><th>Contract Value</th></tr></thead><tbody><tr><td>${id}</td><td>Award</td><td>Supplier</td><td>${awardDate}</td><td>100</td></tr></tbody></table>` });
const start = (from = '2026-01-01', to = '2026-01-31') => newAwardRanges(from, to, new Date('2026-09-14'));
const store = (docs: any[]) => async (doc: any) => { docs.push(structuredClone(doc)); return 'saved'; };
describe('bounded award history', () => {
  it('partitions the date domain including historical and future tails without gaps', () => {
    const state = newAwardRanges(undefined, undefined, new Date('2026-09-14'));
    expect(validateAwardRanges(state)).toEqual(state);
    const ranges = [...state.ranges].sort((a,b) => a.from.localeCompare(b.from));
    expect(ranges[0].from).toBe('1900-01-01'); expect(ranges.at(-1)?.to).toBe('9999-12-31');
    expect(splitAwardRange({from:'2024-02-28',to:'2024-03-01',complete:false})).toEqual([{from:'2024-02-28',to:'2024-02-29',complete:false},{from:'2024-03-01',to:'2024-03-01',complete:false}]);
    expect(splitAwardRange({from:'2024-02-29',to:'2024-02-29',complete:false})).toBeNull();
  });
  it('commits each page and labels completion as dated coverage only', async () => {
    const docs:any[]=[];
    const result=await scrapeAwardRanges(async r=>page(r.page,2,String(r.page)),store(docs),start());
    expect(result).toMatchObject({count:2,pages:2,complete:true,scope:'dated-public-awards',undated:'not-verified'});
    expect(docs.map(d=>d.checkpoint.complete)).toEqual([false,true]);
  });
  it('skips completed ranges but replays the interrupted range after browser loss', async () => {
    const state=start('2025-01-01','2026-01-31'),docs:any[]=[],calls:any[]=[];
    await expect(scrapeAwardRanges(async r=>{if(r.range.from==='2025-01-01')throw Error('Browser check');return page(1,1,'new',r.range.from);},store(docs),state)).rejects.toThrow('Browser check');
    const checkpoint=docs.at(-1).checkpoint;
    const result=await scrapeAwardRanges(async r=>{calls.push(r);return page(1,1,'old',r.range.from);},store(docs),checkpoint);
    expect(calls.map(c=>c.range.from)).toEqual(['2025-01-01']);expect(result.complete).toBe(true);
  });
  it('never trusts an old page offset after a crash or shifted results', async () => {
    const state=start();state.page=39;state.pages=39;state.count=500;
    const calls:any[]=[];await scrapeAwardRanges(async r=>{calls.push(r);return page();},store([]),state);
    expect(calls[0]).toMatchObject({page:1,applySearch:true});
  });
  it('subdivides oversized ranges durably and resumes the children after interruption', async () => {
    const docs:any[]=[];
    await expect(scrapeAwardRanges(async r=>page(1,3,'A',r.range.from),store(docs),start(),{rangePages:1,maxPages:1})).rejects.toThrow('page limit');
    expect(docs.at(-1).checkpoint.ranges).toHaveLength(2);
    const calls:any[]=[];
    await scrapeAwardRanges(async r=>{calls.push(r);return page(1,1,'A',r.range.from);},store(docs),docs.at(-1).checkpoint);
    expect(calls.map(c=>c.range)).toEqual([{from:'2026-01-01',to:'2026-01-16'},{from:'2026-01-17',to:'2026-01-31'}]);
  });
  it('advances one intersecting range per run without changing coverage outside the window', async () => {
    const state = start('2024-01-01', '2026-01-31');
    state.ranges[0].complete = true;
    state.active = 1;
    state.page = 12;
    const window = { from: '2024-04-01', to: '2025-12-15' };
    const docs: any[] = [];
    const calls: string[] = [];
    const capture = async (request: { range: { from: string; to: string } }) => {
      calls.push(request.range.from + '/' + request.range.to);
      return page(1, 1, 'A', request.range.from);
    };
    const first = await scrapeAwardRanges(capture, store(docs), state, { window });
    const next = validateAwardRanges(docs.at(-1).checkpoint);
    expect(first).toMatchObject({ complete: false, window: { ...window, complete: false } });
    expect(next.ranges).toEqual([
      { from: '2026-01-01', to: '2026-01-31', complete: true },
      { from: '2025-01-01', to: '2025-12-15', complete: true },
      { from: '2025-12-16', to: '2025-12-31', complete: false },
      { from: '2024-01-01', to: '2024-12-31', complete: false },
    ]);
    expect(next.page).toBe(0);
    const second = await scrapeAwardRanges(capture, store(docs), next, { window });
    const final = validateAwardRanges(docs.at(-1).checkpoint);
    expect(second).toMatchObject({ complete: false, window: { ...window, complete: true } });
    expect(final.ranges.slice(-2)).toEqual([
      { from: '2024-01-01', to: '2024-03-31', complete: false },
      { from: '2024-04-01', to: '2024-12-31', complete: true },
    ]);
    expect(calls).toEqual(['2025-01-01/2025-12-15', '2024-04-01/2024-12-31']);
    await scrapeAwardRanges(capture, store(docs), final, { window });
    expect(calls).toHaveLength(2);
  });
  it('yields after durably subdividing one long window range', async () => {
    const window = { from: '2026-01-01', to: '2026-01-31' };
    const docs: any[] = [];
    const result = await scrapeAwardRanges(
      async request => page(request.page, 10, String(request.page), request.range.from),
      store(docs), start(), { window },
    );
    expect(result).toMatchObject({ pages: 6, complete: false, window: { complete: false } });
    expect(validateAwardRanges(docs.at(-1).checkpoint).ranges).toEqual(splitAwardRange(start().ranges[0]));
    expect(docs).toHaveLength(6);
  });
  it('rejects a window extending beyond the saved checkpoint before capture', async () => {
    const docs: any[] = [];
    await expect(scrapeAwardRanges(async () => page(), store(docs), start(), {
      window: { from: '2025-12-31', to: '2026-01-31' },
    })).rejects.toThrow('outside the saved checkpoint');
    expect(docs).toHaveLength(0);
  });
  it('reopens the last day of old completed ranges once and preserves their interiors', async () => {
    const old = start('2024-01-01', '2026-01-31');
    delete old.dateFilter;
    old.ranges[0].complete = old.ranges[1].complete = true;
    old.active = 2;
    const docs: any[] = [];
    const calls: unknown[] = [];
    const capture = async (request: { range: { from: string; to: string } }) => {
      calls.push(request.range);
      return page(1, 1, 'A', request.range.from);
    };
    const window = { from: '2025-01-01', to: '2025-12-31' };
    const result = await scrapeAwardRanges(capture, store(docs), old, { window });
    expect(calls).toEqual([{ from: '2025-12-31', to: '2025-12-31' }]);
    expect(result).toMatchObject({ complete: false, window: { ...window, complete: true } });
    const saved = validateAwardRanges(docs.at(-1).checkpoint);
    expect(saved.dateFilter).toBe('exclusive-upper-bound');
    expect(saved.ranges).toEqual([
      { from: '2026-01-01', to: '2026-01-30', complete: true },
      { from: '2026-01-31', to: '2026-01-31', complete: false },
      { from: '2025-01-01', to: '2025-12-30', complete: true },
      { from: '2025-12-31', to: '2025-12-31', complete: true },
      { from: '2024-01-01', to: '2024-12-31', complete: false },
    ]);
    await scrapeAwardRanges(capture, store(docs), saved, { window });
    expect(calls).toHaveLength(1);
  });
  it('accepts identical adjacent source pages only after same-page confirmation', async () => {
    const calls:any[]=[],docs:any[]=[];
    const result=await scrapeAwardRanges(async r=>{calls.push(r);return page(r.page,2);},store(docs),start());
    expect(result.count).toBe(2);expect(calls.filter(r=>r.page===2&&!r.reread)).toHaveLength(1);expect(calls.filter(r=>r.reread)).toHaveLength(2);
  });
  it('uses refreshed rows if the pager changes before the grid', async () => {
    const docs:any[]=[];
    await scrapeAwardRanges(async r=>page(r.page,2,r.page===1||!r.reread?'A':'B'),store(docs),start());
    expect(docs[1].records[0].opportunityId).toBe('B');
  });
  it('rejects a repeated page number without advancing the checkpoint', async () => {
    const docs:any[]=[];await expect(scrapeAwardRanges(async()=>page(1,2),store(docs),start())).rejects.toThrow('did not advance');expect(docs).toHaveLength(1);
  });
  it.each(['Wrong captcha answer','Cancelled','Capacity unavailable'])('does not retry or mark complete on %s', async error => {
    const docs:any[]=[];let calls=0;
    await expect(scrapeAwardRanges(async()=>{calls++;throw Error(error);},store(docs),start())).rejects.toThrow(error);
    expect(calls).toBe(1);expect(docs).toHaveLength(0);
  });
  it('does not retry verification encountered during duplicate confirmation', async () => {
    const docs:any[]=[];
    await expect(scrapeAwardRanges(async r=>{if(r.reread)throw Error('Wrong captcha answer');return page(r.page,2);},store(docs),start())).rejects.toThrow('captcha');expect(docs).toHaveLength(1);
  });
  it('only accepts explicit zero results on the first page, not a blank or malformed grid', async () => {
    const empty=page();empty.html=empty.html.replace(/<tbody>.*<\/tbody>/,'<tbody><tr><td colspan="5">No results found.</td></tr></tbody>');
    expect((await scrapeAwardRanges(async()=>empty,store([]),start())).count).toBe(0);
    const blank={...empty,html:empty.html.replace('No results found.','')};
    await expect(scrapeAwardRanges(async()=>blank,store([]),start())).rejects.toThrow('no readable records');
    await expect(scrapeAwardRanges(async()=>({...empty,html:'Wrong captcha answer'}),store([]),start())).rejects.toThrow('grid');
  });
  it.each(['2025-12-31','','2026-02-01'])('rejects an ignored date filter or undated record (%s)', async awardDate => {
    await expect(scrapeAwardRanges(async()=>page(1,1,'A',awardDate),store([]),start())).rejects.toThrow('date filter');
  });
  it('does not mark an unsplittable one-day range complete when capped', async () => {
    const docs:any[]=[];await expect(scrapeAwardRanges(async()=>page(1,3),store(docs),start('2026-01-01','2026-01-01'),{rangePages:1})).rejects.toThrow('safe page limit');expect(docs.at(-1).checkpoint.complete).toBe(false);
  });
  it('does not mutate caller checkpoints when persistence fails', async () => {
    const state=start();await expect(scrapeAwardRanges(async()=>page(),async()=>{throw Error('disk');},state)).rejects.toThrow('disk');expect(state.complete).toBe(false);expect(state.count).toBe(0);
  });
  it('rejects overlapping, missing, malformed and falsely complete checkpoints', () => {
    const state=start('2025-01-01','2026-01-31');
    expect(()=>validateAwardRanges({...state,complete:true})).toThrow('completion');
    expect(()=>validateAwardRanges({...state,active:1})).toThrow('completion');
    expect(()=>validateAwardRanges({...state,ranges:[{from:'2026-02-30',to:'2026-03-31',complete:false}]})).toThrow('date');
    expect(()=>validateAwardRanges({...state,ranges:[...state.ranges,state.ranges[0]]})).toThrow('overlaps');
  });
});

it('sends the day after the requested maximum and never clicks during confirmation', async () => {
  const { awardRangeCapture } = await import('../zoer/src/award-range-capture');
  const calls:any[]=[];
  const capture=awardRangeCapture(async options=>{calls.push(options);return {...page(),html:page().html+'<div class="iv-filter-summary"><h3 class="tag-label">Award Date (min) :</h3><ul><li class="tag-text">2026-01-01</li></ul><h3 class="tag-label">Award Date (max) :</h3><ul><li class="tag-text">2026-02-01</li></ul></div>'};},{from:'#verifiedMin',to:'#verifiedMax'});
  const range={from:'2026-01-01',to:'2026-01-31'};
  await capture({range,page:1,applySearch:true});
  await capture({range,page:2,applySearch:false});
  await capture({range,page:2,applySearch:false,reread:true});
  expect(calls[0]).toMatchObject({applySearch:true,pageNumber:1,searchFields:[{selector:'#verifiedMin',value:range.from},{selector:'#verifiedMax',value:'2026-02-01'}]});
  expect(calls[1].continuePage).toBe(2);expect(calls[2].continuePage).toBeUndefined();expect(calls[2].pageNumber).toBeUndefined();
});

it('keeps an open-ended history search within the supported date field', async () => {
  const { awardRangeCapture, AWARD_DATE_FIELDS } = await import('../zoer/src/award-range-capture');
  const capture = awardRangeCapture(async options => {
    expect(options.searchFields).toEqual([{ selector: AWARD_DATE_FIELDS.from, value: '2026-01-01' }]);
    return { ...page(), html: page().html + '<div class="iv-filter-summary"><span class="tag-label">Award Date (min) :</span><ul><li class="tag-text">2026-01-01</li></ul></div>' };
  }, AWARD_DATE_FIELDS);
  await capture({ range: { from: '2026-01-01', to: '9999-12-31' }, page: 1, applySearch: true });
});

it('checks the full pager while saving only awards inside the intended date window', async () => {
  const { awardRangeCapture, AWARD_DATE_FIELDS } = await import('../zoer/src/award-range-capture');
  const tags = '<div class="iv-filter-summary"><span class="tag-label">Award Date (min) :</span><ul><li class="tag-text">2022-05-18</li></ul><span class="tag-label">Award Date (max) :</span><ul><li class="tag-text">2022-05-19</li></ul></div>';
  const target = page(1, 2, 'Target', '2022-05-18');
  const spill = page(2, 2, 'Upper bound', '2022-05-19');
  const capture = awardRangeCapture(async options => {
    const result = options.continuePage ? spill : target;
    return { ...result, html: result.html + tags };
  }, AWARD_DATE_FIELDS);
  const docs: any[] = [];
  const result = await scrapeAwardRanges(capture, store(docs), start('2022-05-18', '2022-05-18'));
  expect(result).toMatchObject({ complete: true, count: 1, pages: 2 });
  expect(docs.map(doc => doc.records.map((row: any) => row.opportunityId))).toEqual([['Target'], []]);
});

it('shows range coverage and undated limits without equating processed rows with unique records', async () => {
  const { awardProgress } = await import('../zoer/dashboard/award-progress');
  expect(awardProgress(start())).toContain('0 of 1 date ranges checked');
  expect(awardProgress(start())).toContain('Undated awards are not verified');
  expect(awardProgress(start())).not.toContain('rows saved');
});

it('recognizes the actual BC Bid empty-range layout without table headers', async () => {
  const { readFileSync } = await import('node:fs');
  const html=readFileSync(new URL('./fixtures/awards/empty-date-range.html',import.meta.url),'utf8');
  const result=await scrapeAwardRanges(async()=>({...page(),html}),store([]),start());
  expect(result).toMatchObject({count:0,complete:true,undated:'not-verified'});
  await expect(scrapeAwardRanges(async()=>({...page(),html:html.replace('0 Record(s)','1 Record(s)')}),store([]),start())).rejects.toThrow('grid');
});
it('rejects a source response that does not confirm both date filters, including an empty result', async () => {
  const { awardRangeCapture, AWARD_DATE_FIELDS }=await import('../zoer/src/award-range-capture');
  const capture=awardRangeCapture(async()=>page(),AWARD_DATE_FIELDS);
  await expect(capture({range:{from:'2026-01-01',to:'2026-01-31'},page:1,applySearch:true})).rejects.toThrow('confirm the award date filters');
});
