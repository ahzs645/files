import reference from '../data/bc-bid-filter-reference.json';
export function filterReferenceRecords() {
  return [{id: reference.id, kind: 'reference-release', title: 'BC Bid regions and industry categories', data: reference},
    ...reference.regions.map(term => ({id:`reference-term:BCBID-region:${term.code}`,kind:'reference-term',title:term.title,data:{schemaVersion:1,scheme:'BCBID-region',releaseId:reference.id,...term,sourceUrl:reference.sourceUrl,capturedAt:reference.capturedAt}})),
    ...reference.industryCategories.map(term => ({id:`reference-term:BCBID-industry:${term.code}`,kind:'reference-term',title:term.title,data:{schemaVersion:1,scheme:'BCBID-industry',releaseId:reference.id,...term,parentId:null,sourceUrl:reference.sourceUrl,capturedAt:reference.capturedAt}}))];
}
/** Only source-labelled detail values or verified source filter membership qualify. Buyer-derived places remain separate. */
/** Recover flattened source labels only when the complete field has a unique segmentation. */
export function sourceRegionLabels(value: string): string[] {
  const titles=[...new Set(reference.regions.map(t=>t.title))].sort((a,b)=>b.length-a.length);
  const text=value.replace(/\s+/g,' ').trim(), solutions: string[][]=[];
  function visit(rest:string,path:string[]) {
    if(solutions.length>1 || path.length>40) return;
    if(!rest) {solutions.push(path);return;}
    for(const title of titles) if(rest===title || rest.startsWith(title+' ')) visit(rest.slice(title.length).trim(),[...path,title]);
  }
  visit(text,[]); return solutions.length===1 ? solutions[0] : [];
}
export function sourceMetadata(row: any, doc?: any) {
  if (row.sourceId && row.sourceId !== 'bc-bid') return row;
  const fields: any[] = Array.isArray(row.detailFields) ? row.detailFields : [];
  const categories = fields.filter(f => /^Industry Category$/i.test(f.label?.trim() || '')).flatMap(f => String(f.value).split(/\s*[,;\n]\s*/)).filter(v => reference.industryCategories.some(t => t.title === v));
  if(doc?.scope === 'bcbid-targeted' && reference.industryCategories.some(t=>t.title===doc.filters?.industryCategory)) categories.push(...(row.industryCategories ?? []),doc.filters.industryCategory);
  const regionLabels = fields.filter(f => /^Regions?$/i.test(f.label?.trim() || '')).flatMap(f => String(f.value).split(/\s*[,;\n]\s*/).flatMap(sourceRegionLabels));
  if (doc?.scope === 'bcbid-targeted' && doc.filters?.region) regionLabels.push(doc.filters.region);
  const sourceRegions = regionLabels.flatMap(label => { const candidates = reference.regions.filter(t => t.title === label); return candidates.length === 1 ? candidates : []; });
  const next = {...row};
  if(regionLabels.length) next.sourceRegionLabels=[...new Set(regionLabels)];
  const ambiguous=regionLabels.filter(label=>reference.regions.filter(t=>t.title===label).length!==1);
  if(ambiguous.length) next.sourceRegionUnresolved=ambiguous.map(label=>({label,candidateIds:reference.regions.filter(t=>t.title===label).map(t=>'reference-term:BCBID-region:'+t.code)}));
  if (categories.length) { next.industryCategories = [...new Set(categories)].sort(); next.industryCategoryProvenance = {sourceUrl: doc?.sourceUrl ?? row.detailUrl, method:doc?.filters?.industryCategory?'verified-source-industry-category-filter':'source-detail-field', capturedAt: doc?.capturedAt ?? row.industryCategoryProvenance?.capturedAt ?? new Date().toISOString()}; if(categories.length === 1) next.category=categories[0]; }
  if (sourceRegions.length) { next.sourceRegionCodes = [...new Set([...(row.sourceRegionCodes ?? []), ...sourceRegions.map(t=>t.code)])]; next.sourceRegionPath = reference.regions.filter(t=>next.sourceRegionCodes.includes(t.code)).map(t=>t.path).join(''); next.sourceRegionProvenance={sourceUrl:doc?.sourceUrl ?? row.detailUrl,method:doc?.filters?.region?'verified-source-region-filter':'source-detail-field',capturedAt:doc?.capturedAt ?? row.sourceRegionProvenance?.capturedAt ?? new Date().toISOString()}; }
  if (Array.isArray(next.industryCategories)) next.industryCategoryCodes = reference.industryCategories.filter(t=>next.industryCategories.includes(t.title)).map(t=>t.code);
  return next;
}
