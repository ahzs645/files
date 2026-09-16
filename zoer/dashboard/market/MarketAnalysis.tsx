import { buyerLevels, isBuyerLevel, nextBuyerLevel, parseBuyerTrail, BUYER_MAPPING_VERSION, type BuyerLevel } from './buyers';
import { navigatePlugin, usePluginLocation, pluginHref, patchPluginQuery } from "../navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Btn, Select, type IntrospectionTable } from '@zoer/plugin-ui/database';
import { Modal, DatePicker, InMemoryResourceGrid, CountBadge } from '@zoer/plugin-ui/analysis';
import { List, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { defaultFilters, inspectionFilters, type Award, type MarketFilters, type MarketOptions, type Slice, type Overview, type Metadata, type Trends, type Distribution, type Comparison, type Matrix, type QualityFlag, type MappingOverview } from './model';
import { useMarket } from './useMarket';
import { ComparisonPlot, DependencePlot, Heatmap, LinePlot, Metrics, Panel, compact, count, money, percent } from './charts';
import { downloadRecords } from '../export';
import './market.css';

const tabs = [
  { id: 'overview', label: 'Overview' }, { id: 'trends', label: 'Trends' }, { id: 'buyers', label: 'Buyers' }, { id: 'suppliers', label: 'Suppliers' },
  { id: 'sizes', label: 'Award sizes' }, { id: 'compare', label: 'Compare' }, { id: 'mix', label: 'Procurement mix' }, { id: 'relationships', label: 'Relationships' }, { id: 'quality', label: 'Data quality' }, { id: 'mapping', label: 'Buyer mapping' },
] as const;
type View = typeof tabs[number]['id'];
/** Desktop: a vertical list beside the content, as in Chats. Mobile: the page title becomes a picker. */
function ViewNav({ value, href, onChange }: { value: View; href: (view: View) => string; onChange: (view: View) => void }) {
  return <aside className="market-nav"><nav aria-label="Market analysis views">{tabs.map(tab => <a key={tab.id} id={`market-analysis-tab-${tab.id}`} href={href(tab.id)} aria-current={tab.id === value ? 'page' : undefined}
    onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onChange(tab.id); }}>{tab.label}</a>)}</nav></aside>;
}
const qualityLabels: Record<QualityFlag, string> = { currency: 'Currency not stated', future: 'Future-dated awards', undated: 'Missing or invalid dates', placeholder: 'Placeholder suppliers', value: 'Missing or invalid values', negative: 'Negative values', zero: 'Zero values', contract: 'Missing contract number', justification: 'Missing justification' };
const qualityDetails: Record<QualityFlag, string> = { currency: 'Excluded from CAD totals; choose Unspecified to inspect their values separately.', future: 'Excluded by default. Dates may need source verification.', undated: 'Included in all-time totals but absent from dated trends and comparisons.', placeholder: 'Unknown or migrated supplier names; excluded by default.', value: 'Counted as records; omitted from value statistics.', negative: 'Included in net totals; excluded from positive-value concentration.', zero: 'Included in counts and size statistics.', contract: 'Missing identifier; not proof of a duplicate or an invalid award.', justification: 'Missing descriptive text; not evidence of a procurement violation.' };
function Field({ label, children }: { label: string; children: ReactNode }) { return <div className="market-field"><span>{label}</span>{children}</div>; }
/** Compact enumerations fit their contents; resource inventories explicitly opt into search. */
function Choice({ label, value, values, onChange, searchable = false }: { label: string; value: string; values: { value: string; label: string }[]; onChange: (value: string) => void; searchable?: boolean }) {
  return <Field label={label}><Select presentation="dropdown" searchable={searchable} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>{values.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>;
}
const filterKeys = Object.keys(defaultFilters) as (keyof MarketFilters)[];
const activeFilters = (value: MarketFilters) => filterKeys.filter(key => value[key] !== defaultFilters[key]).length;
/** Filters live behind a toolbar button; edits are a draft until Apply, and the button carries the active count. */
function FiltersDialog({ value, meta, apply, close }: { value: MarketFilters; meta?: Metadata; apply: (f: MarketFilters) => void; close: () => void }) {
  const [draft, setDraft] = useState(value);
  const set = <K extends keyof MarketFilters>(key: K, v: MarketFilters[K]) => setDraft({ ...draft, [key]: v });
  const options = (values: string[], all: string) => [{ value: '', label: all }, ...values.map(v => ({ value: v, label: v }))];
  return <Modal mobileSheet title="Filters" onClose={close} footer={<>
    <Btn variant="ghost" className="mr-auto" disabled={!activeFilters(draft) && !activeFilters(value)} onClick={() => apply({ ...defaultFilters })}>Reset</Btn>
    <Btn variant="secondary" onClick={close}>Cancel</Btn>
    <Btn variant="primary" onClick={() => apply(draft)}>Apply</Btn>
  </>}>
    <div className="market-filter-grid">
      <DatePicker label="Award date from" value={draft.from} onChange={v => set('from', v)} max={draft.to || undefined} />
      <DatePicker label="Award date to" value={draft.to} onChange={v => set('to', v)} min={draft.from || undefined} />
      <Choice label="Buyer" searchable value={draft.buyer} values={options(meta?.buyers ?? [], 'All buyers')} onChange={v => set('buyer', v)} />
      <Field label="Buyer name or participant"><input className="market-input" type="search" aria-label="Buyer name or participant" value={draft.buyerSearch} onChange={e => set('buyerSearch', e.target.value)} placeholder="Search original names and joint participants" /></Field>
      <Choice label="Supplier" searchable value={draft.supplier} values={options(meta?.suppliers ?? [], 'All suppliers')} onChange={v => set('supplier', v)} />
      <Choice label="Procurement type" searchable value={draft.type} values={options(meta?.types ?? [], 'All types')} onChange={v => set('type', v)} />
      <Choice label="Currency" value={draft.currency} values={(meta?.currencies.length ? meta.currencies : ['CAD']).map(v => ({ value: v, label: v === 'UNSPECIFIED' ? 'Unspecified (not converted)' : v }))} onChange={v => set('currency', v)} />
      <Field label="Minimum award value"><input className="market-input" type="number" min="0" step="any" aria-label="Minimum award value" placeholder="No minimum" value={draft.minValue} onChange={e => set('minValue', e.target.value)} /></Field>
    </div>
    <div className="market-checks"><label><input type="checkbox" checked={draft.includePlaceholders} onChange={e => set('includePlaceholders', e.target.checked)} />Include placeholder suppliers</label><label><input type="checkbox" checked={draft.includeFuture} onChange={e => set('includeFuture', e.target.checked)} />Include future-dated awards</label></div>
  </Modal>;
}
function schema(name: string, columns: [string, string, string][]): IntrospectionTable { return { schema: 'BC Bid', name, columns: columns.map(([name,, type]) => ({ name, type, nullable: true, default: null })) }; }
const entityColumns: [string, string, string][] = [['name', 'Name', 'text'], ['count', 'Awards', 'integer'], ['value', 'Award value', 'numeric'], ['share', 'Value share', 'numeric'], ['counterparties', 'Counterparties', 'integer'], ['median', 'Median award', 'numeric'], ['dependence', 'Top counterparty share', 'numeric'], ['leading', 'Leading counterparty', 'text']];
const entityTable = schema('Market participants', entityColumns);
const entityLabels = Object.fromEntries(entityColumns.map(([key, name]) => [key, name]));
const recordColumns: [string, string, string][] = [['date', 'Award date', 'date'], ['opportunityDescription', 'Opportunity', 'text'], ['buyer', 'Buyer at selected level', 'text'], ['buyerOriginal', 'Original buyer', 'text'], ['buyerClean', 'Clean buyer / office', 'text'], ['buyerOrganization', 'Organization', 'text'], ['buyerType', 'Buyer type', 'text'], ['buyerMappingStatus', 'Mapping status', 'text'], ['buyerParticipants', 'Named participants', 'text'], ['supplier', 'Supplier', 'text'], ['type', 'Procurement type', 'text'], ['value', 'Award value', 'numeric'], ['currencyCode', 'Currency', 'text'], ['contractNumber', 'Contract number', 'text'], ['opportunityId', 'Opportunity ID', 'text'], ['justification', 'Justification', 'text'], ['sourceUrl', 'Source URL', 'text']];
const recordTable = schema('Analysis awards', recordColumns), recordLabels = Object.fromEntries(recordColumns.map(([key, name]) => [key, name]));
const comparisonColumns: [string, string, string][] = [['name', 'Name', 'text'], ['a', 'Period A', 'numeric'], ['b', 'Period B', 'numeric'], ['delta', 'Change', 'numeric'], ['change', 'Change %', 'numeric'], ['aCount', 'A awards', 'integer'], ['bCount', 'B awards', 'integer']];
const comparisonTable = schema('Period comparison', comparisonColumns), comparisonLabels = Object.fromEntries(comparisonColumns.map(([key, name]) => [key, name]));
type Inspect = (slice: Slice, title: string, filters?: MarketFilters) => void;
function AwardRecords({ selection }: { selection: { slice: Slice; title: string; filters: MarketFilters } }) {
  const query = useMarket<Award[]>('records', selection.filters, { slice: selection.slice });
  const data = query.current ? query.data : undefined;
  return <div className="market-stack">{selection.slice.quality && <p className="market-caption">Uses all saved records regardless of filters.</p>}
      {query.error && <div role="alert" className="market-error">{query.error}<button onClick={query.retry}>Retry records</button></div>}
      {!data && !query.error && <p role="status">Loading matching awards…</p>}
      {data && <><div className="market-actions"><strong>{count(data.length)} matching awards</strong><Btn size="sm" variant="secondary" disabled={!data.length} onClick={() => downloadRecords(data, 'award', 'csv')}>Download matching CSV</Btn></div>
        <InMemoryResourceGrid resourceKey="bcbid:market:records" table={recordTable} rows={data} columnLabels={recordLabels} className="market-record-grid" renderCell={(column, row) => column === 'value' ? money(row.value, row.currencyCode) : column === 'currencyCode' && row.currencyCode === 'UNSPECIFIED' ? 'Not stated' : undefined} />
      </>}
    </div>;
}
function Records({ selection, close }: { selection: { slice: Slice; title: string; filters: MarketFilters }; close: () => void }) {
  return <Modal mobileSheet title={`Awards · ${selection.title}`} onClose={close} footer={<Btn variant="secondary" onClick={close}>Done</Btn>}><AwardRecords selection={selection}/></Modal>;
}
function RankedList({ rows, currency, dimension, inspect, limit = 8 }: { rows: Overview['buyers']; currency: string; dimension: 'buyer' | 'supplier' | 'type'; inspect: Inspect; limit?: number }) {
  const maximum = Math.max(1, ...rows.map(r => Math.max(0, r.value)));
  return <div className="market-rank-list">{rows.slice(0, limit).map(row => <button type="button" key={row.name} onClick={() => inspect({ [dimension]: row.name }, row.name)}><span className="market-rank-line"><span>{row.name}</span><span>{money(row.value, currency, true)} · {count(row.count)} awards</span></span><span className="market-bar" style={{ width: `${Math.max(0, row.value) / maximum * 100}%` }} /></button>)}</div>;
}
function OverviewView({ data, currency, inspect }: { data: Overview; currency: string; inspect: Inspect }) {
  return <div className="market-stack"><Metrics items={[
    { label: 'Award value', value: money(data.value, currency, true), detail: `${count(data.valuedCount)} valued records` },
    { label: 'Awards', value: count(data.count) },
    { label: 'Median award', value: money(data.median, currency) },
    { label: 'Buyers', value: count(data.buyerCount) }, { label: 'Suppliers', value: count(data.supplierCount) },
    { label: 'Top 10 supplier share', value: data.positiveTotal > 0 ? percent(data.top10Share) : '—', detail: 'Positive value only' },
  ]} />
    <Panel title="Market signals"><ul className="market-signals">
      <li><strong>{data.suppliersFor80 === null ? 'No positive award value' : `${count(data.suppliersFor80)} suppliers account for 80% of positive award value.`}</strong> {data.suppliersFor80 !== null && `That is ${percent(data.suppliersFor80 / Math.max(1, data.supplierCount))} of the suppliers in this slice.`}</li>
      <li>{data.buyers[0] ? <><strong>{data.buyers[0].name}</strong> is the largest buyer by recorded award value: {money(data.buyers[0].value, currency)} across {count(data.buyers[0].count)} awards.</> : 'No buyers match the current filters.'}</li>
      <li>{data.types[0] ? <><strong>{data.types[0].name}</strong> is the largest procurement type by recorded value.</> : 'No procurement types match the current filters.'}</li>
    </ul></Panel>
    <div className="market-columns"><Panel title="Leading buyers" description={`Top ${Math.min(8, data.buyerCount)} of ${count(data.buyerCount)}. Select one for its awards.`}><RankedList rows={data.buyers} currency={currency} dimension="buyer" inspect={inspect} /></Panel><Panel title="Leading procurement types" description="By recorded value."><RankedList rows={data.types} currency={currency} dimension="type" inspect={inspect} /></Panel></div>
  </div>;
}
function EntityView({ data, kind, currency, inspect, focus, explore, filters }: { filters: MarketFilters; data: Overview; kind: 'buyer' | 'supplier'; currency: string; inspect: Inspect; focus: (name: string) => void; explore?: (name: string, level: BuyerLevel) => void }) {
  const [search, setSearch] = useState('');
  const all = kind === 'buyer' ? data.buyers : data.suppliers;
  const rows = useMemo(() => all.filter(r => r.name.toLowerCase().includes(search.trim().toLowerCase())), [all, search]);
  if (kind === 'buyer' && all.length === 1 && !all[0].nextLevel) return <Panel title={`Awards · ${all[0].name}`} description="One buyer in this scope. Showing its awards with the current filters and original issuer names."><AwardRecords selection={{slice:{buyer:all[0].name},title:all[0].name,filters}}/></Panel>;
  return <div className="market-stack">
    {kind === 'buyer' ? <Panel title="Buyer dependence" description="Top 100 buyers. X: awards; Y: top supplier’s share; bubble: positive value."><DependencePlot rows={rows} currency={currency} inspect={inspect} /></Panel> : <Panel title="Supplier concentration" description="Ranked by positive award value. The dashed line marks 80%."><LinePlot data={data.pareto} metric="value" currency={currency} pareto /></Panel>}
    <Panel title={kind === 'buyer' ? 'Buyer directory' : 'Supplier directory'} description="Shares and dependence use positive values only.">
      <Field label={kind === 'buyer' ? 'Search buyers' : 'Search suppliers'}><input className="market-input" type="search" aria-label={kind === 'buyer' ? 'Search buyers' : 'Search suppliers'} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search names" /></Field>
      <p className="market-caption">{count(rows.length)} of {count(all.length)} participants.</p>
      <InMemoryResourceGrid resourceKey={`bcbid:market:${kind}`} rows={rows} table={entityTable} columnLabels={{ ...entityLabels, name: kind === 'buyer' ? 'Buyer' : 'Supplier', counterparties: kind === 'buyer' ? 'Suppliers' : 'Buyers' }} className="market-grid"
        renderCell={(column, row) => column === 'name' && kind === 'buyer' ? <div className="market-buyer-cell"><button type="button" onClick={() => inspect({ buyer: row.name }, row.name)}>{row.name}</button>{explore && row.nextLevel ? <Btn size="sm" variant="secondary" aria-label={`Explore buyers within ${row.name}`} onClick={() => explore(row.name, row.nextLevel as BuyerLevel)}>Explore</Btn> : <Btn size="sm" variant="secondary" aria-label={`View awards for ${row.name}`} onClick={() => inspect({buyer:row.name},row.name)}>View awards</Btn>}</div> : column === 'value' || column === 'median' ? money(row[column], currency) : column === 'share' || column === 'dependence' ? percent(row[column]) : undefined}
        onOpenRow={row => inspect({ [kind]: row.name }, row.name)} rowActions={row => [...(explore && row.nextLevel ? [{ id: 'explore', label: 'Explore buyers within', onSelect: () => explore(row.name, row.nextLevel as BuyerLevel) }] : []), { id: 'focus', label: 'Focus in analysis', onSelect: () => focus(row.name) }]} />
    </Panel>
  </div>;
}
function TrendsView({ data, currency, options, change, meta, inspect }: { data: Trends; currency: string; options: MarketOptions; change: (o: MarketOptions) => void; meta: Metadata; inspect: Inspect }) {
  const [normalized, setNormalized] = useState(false), metric = options.metric ?? 'value';
  return <div className="market-stack"><Panel title="Awards over time" description={data.undated ? `${count(data.undated)} undated records excluded.` : undefined} action={<Choice label="Trend metric" value={metric} values={[{ value: 'value', label: 'Award value' }, { value: 'count', label: 'Award count' }]} onChange={value => change({ ...options, metric: value as 'value' | 'count' })} />}><LinePlot data={data.series} metric={metric} currency={currency} /><details><summary>Monthly values and awards</summary><div className="market-rank-list">{data.series.map(row => <button key={row.month} onClick={() => inspect({ month: row.month }, row.month)}><span className="market-rank-line"><span>{row.month}</span><span>{money(row.value, currency, true)} · {count(row.count)} awards</span></span></button>)}</div></details></Panel>
      <Panel title="Buyer spending calendar" description={`Top ${data.buyers.length} buyers in ${data.year}; ${count(data.shownCount)} of ${count(data.yearCount)} awards that year.`} action={<Choice label="Heatmap year" value={data.year} values={[...new Set([data.year, ...meta.years])].sort().reverse().map(y => ({ value: y, label: y }))} onChange={year => change({ ...options, year })} />}>
        <label className="market-checks"><input type="checkbox" checked={normalized} onChange={e => setNormalized(e.target.checked)} />Share within each displayed buyer row</label>
        <Heatmap rows={data.buyers.map(r => r.name)} columns={data.months} cells={data.cells} metric={metric} currency={currency} normalized={normalized} inspect={inspect} months />
      </Panel>
  </div>;
}
function SizesView({ data, currency, inspect }: { data: Distribution; currency: string; inspect: Inspect }) {
  const [metric, setMetric] = useState<'count' | 'value'>('count');
  const maximum = Math.max(1, ...data.bins.map(b => Math.abs(b[metric])));
  return <div className="market-stack"><Metrics items={[{ label: 'Median award', value: money(data.median, currency) }, { label: 'Middle 50% of values', value: `${money(data.q1, currency, true)} – ${money(data.q3, currency, true)}` }, { label: 'Largest recorded award', value: money(data.max, currency, true) }]} />
    <Panel title="Award-size distribution" description={`${count(data.known)} of ${count(data.count)} records have values. Ranges exclude their upper bound.`} action={<Choice label="Distribution metric" value={metric} values={[{ value: 'count', label: 'Award count' }, { value: 'value', label: 'Net award value' }]} onChange={v => setMetric(v as 'count' | 'value')} />}>
      <div className="market-rank-list">{data.bins.map(bin => <button key={bin.label} onClick={() => inspect(bin.slice, `Award sizes · ${bin.label}`)}><span className="market-rank-line"><span>{bin.label}</span><span>{count(bin.count)} awards · {money(bin.value, currency, true)}</span></span><span className="market-bar" style={{ width: `${Math.abs(bin[metric]) / maximum * 100}%` }} /></button>)}</div>
      {data.missing > 0 && <p className="market-caption">{count(data.missing)} records have no numeric value.</p>}
    </Panel>
  </div>;
}
function CompareView({ data, options, change, filters, inspect }: { data: Comparison; options: MarketOptions; change: (o: MarketOptions) => void; filters: MarketFilters; inspect: Inspect }) {
  const value = (n: number) => data.metric === 'value' ? money(n, filters.currency) : count(n);
  const viewPeriod = (row: Comparison['rows'][number], period: 'a' | 'b') => inspect({ [data.dimension]: row.name, from: period === 'a' ? data.aFrom : data.bFrom, to: period === 'a' ? data.aTo : data.bTo }, `${row.name} · Period ${period.toUpperCase()}`, { ...filters, from: '', to: '' });
  return <div className="market-stack"><Metrics items={[{ label: `Period A · ${data.aFrom} to ${data.aTo}`, value: value(data.metric === 'value' ? data.aValue : data.aCount), detail: `${count(data.aCount)} saved awards` }, { label: `Period B · ${data.bFrom} to ${data.bTo}`, value: value(data.metric === 'value' ? data.bValue : data.bCount), detail: `${count(data.bCount)} saved awards` }, { label: 'Change', value: value(data.metric === 'value' ? data.bValue - data.aValue : data.bCount - data.aCount) }]} />
    {data.warnings.length > 0 && <div className="market-scope">{data.warnings.map(w => <p key={w}>{w}</p>)}</div>}
    <Panel title="Largest changes" description="Top 8 by absolute change. Gray = period A, accent = period B."><ComparisonPlot data={data} currency={filters.currency} /></Panel>
    <Panel title="Full comparison" description="Open a row for period B awards; row actions show period A.">
      <InMemoryResourceGrid resourceKey="bcbid:market:comparison" table={comparisonTable} columnLabels={comparisonLabels} rows={data.rows} className="market-grid" renderCell={(column, row) => column === 'change' ? row.change === null ? 'No positive baseline' : percent(row.change) : ['a', 'b', 'delta'].includes(column) ? value(Number(row[column as 'a'])) : undefined} onOpenRow={row => viewPeriod(row, 'b')} rowActions={row => [{ id: 'period-a', label: 'View period A awards', onSelect: () => viewPeriod(row, 'a') }, { id: 'period-b', label: 'View period B awards', onSelect: () => viewPeriod(row, 'b') }]} />
    </Panel>
  </div>;
}
function ComparisonControls({ options, change }: { options: MarketOptions; change: (options: MarketOptions) => void }) {
  const year = new Date().getUTCFullYear() - 1;
  return <section className="market-panel" aria-label="Comparison periods"><p className="market-caption">Replaces the shared date range; other filters still apply.</p><div className="market-periods">
    <DatePicker label="Period A from" value={options.aFrom ?? `${year - 1}-01-01`} onChange={aFrom => change({ ...options, aFrom })} /><DatePicker label="Period A to" value={options.aTo ?? `${year - 1}-12-31`} onChange={aTo => change({ ...options, aTo })} />
    <DatePicker label="Period B from" value={options.bFrom ?? `${year}-01-01`} onChange={bFrom => change({ ...options, bFrom })} /><DatePicker label="Period B to" value={options.bTo ?? `${year}-12-31`} onChange={bTo => change({ ...options, bTo })} />
    <Choice label="Compare by" value={options.dimension ?? 'buyer'} values={[{ value: 'buyer', label: 'Buyer' }, { value: 'supplier', label: 'Supplier' }, { value: 'type', label: 'Procurement type' }]} onChange={dimension => change({ ...options, dimension: dimension as 'buyer' | 'supplier' | 'type' })} />
    <Choice label="Comparison metric" value={options.metric ?? 'value'} values={[{ value: 'value', label: 'Award value' }, { value: 'count', label: 'Award count' }]} onChange={metric => change({ ...options, metric: metric as 'value' | 'count' })} />
  </div></section>;
}
function MatrixView({ data, kind, currency, inspect }: { data: Matrix; kind: 'mix' | 'relationships'; currency: string; inspect: Inspect }) {
  const [metric, setMetric] = useState<'value' | 'count'>('value'), [normalized, setNormalized] = useState(false);
  return <Panel title={kind === 'mix' ? 'Buyer × procurement type' : 'Buyer × supplier relationships'} description={`Top ${data.rows.length} of ${count(data.buyerCount)} buyers × top ${data.columns.length} of ${count(data.columnCount)} ${kind === 'mix' ? 'types' : 'suppliers'}; ${count(data.shownCount)} of ${count(data.totalCount)} awards.`} action={<Choice label="Matrix metric" value={metric} values={[{ value: 'value', label: 'Award value' }, { value: 'count', label: 'Award count' }]} onChange={v => setMetric(v as 'value' | 'count')} />}>
    <label className="market-checks"><input type="checkbox" checked={normalized} onChange={e => setNormalized(e.target.checked)} />Share within displayed rows</label>
    <Heatmap rows={data.rows} columns={data.columns} cells={data.cells} metric={metric} currency={currency} normalized={normalized} inspect={inspect} />
  </Panel>;
}
function QualityView({ data, inspect }: { data: Metadata; inspect: Inspect }) {
  return <div className="market-stack"><p className="market-caption">Covers all {count(data.count)} saved awards regardless of filters. Flags can overlap.</p>
    <Metrics items={[{ label: 'Saved awards', value: count(data.count) }, { label: 'Date range', value: data.firstDate ? `${data.firstDate} – ${data.lastDate}` : 'No valid dates' }, { label: 'Procurement types', value: count(data.types.length) }]} />
    <div className="market-quality">{data.quality.map(({ flag, count: n }) => <button key={flag} type="button" onClick={() => inspect({ quality: flag }, qualityLabels[flag])}><span>{qualityLabels[flag]}</span><strong>{count(n)} <small>({percent(data.count ? n / data.count : 0)})</small></strong><span>{qualityDetails[flag]}</span></button>)}</div>
    <Panel title="How to read these figures"><ul className="market-signals"><li>Totals are recorded award amounts on their award date, not actual spend.</li><li>Buyer grouping uses a versioned proposed mapping. Original labels remain available; ambiguous names stay separate. Review Buyer mapping for evidence and limitations.</li><li>Concentration uses positive values only. Currencies are not converted.</li><li>Winner records say nothing about bidder counts, win rates, or compliance.</li></ul></Panel>
  </div>;
}
const mappingColumns: [string, string, string][] = [['sourceName', 'Original buyer', 'text'], ['cleanName', 'Clean buyer / office', 'text'], ['organization', 'Applied organization', 'text'], ['group', 'Applied group', 'text'], ['buyerType', 'Applied buyer type', 'text'], ['status', 'Mapping status', 'text'], ['awardCount', 'Saved awards', 'integer'], ['proposedHierarchy', 'Proposed hierarchy', 'text'], ['participants', 'Named participants', 'text']];
const mappingTable = schema('Buyer mapping', mappingColumns), mappingLabels = Object.fromEntries(mappingColumns.map(([key, label]) => [key, label]));
function MappingView({ data }: { data: MappingOverview }) {
  const [search, setSearch] = useState(''), [status, setStatus] = useState(''), [selected, setSelected] = useState<MappingOverview['entries'][number]>();
  const entries = data.entries.filter(e => (!status || e.status === status) && [e.sourceName, e.cleanName, e.organization, e.group, e.buyerType, e.participants].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="market-stack"><Panel title="Buyer names and relationships" description={`Mapping ${data.version}. Covers the reviewed award/opportunity labels plus new award labels. Saved award counts ignore analysis filters.`}>
    <p className="market-caption">Names and parent relationships are proposed. Ambiguous labels retain their own organization; joint buyers are counted once with no value allocation to participants. Current references do not establish historical ownership dates. Supplier names remain unchanged.</p>
    <Metrics items={[{ label: 'Source labels', value: count(data.entries.length) }, { label: 'Need review or mapping', value: count(data.reviewCount) }, { label: 'Saved awards', value: count(data.awardCount) }]} />
    <div className="market-filter-grid"><Field label="Search buyer mappings"><input className="market-input" aria-label="Search buyer mappings" type="search" value={search} onChange={e => setSearch(e.target.value)} /></Field><Choice label="Mapping status" value={status} values={['', 'Review required', 'Not mapped', 'Label-supported proposal', 'Externally-supported proposal'].map(v => ({ value: v, label: v || 'All statuses' }))} onChange={setStatus} /></div>
    <p className="market-caption">{count(entries.length)} mappings. Open a row for its rationale and source references.</p>
    <InMemoryResourceGrid resourceKey="bcbid:market:mapping" table={mappingTable} rows={entries} columnLabels={mappingLabels} className="market-grid" onOpenRow={row => setSelected(row)} />
  </Panel>{selected && <Modal mobileSheet title="Buyer mapping evidence" onClose={() => setSelected(undefined)} footer={<Btn variant="secondary" onClick={() => setSelected(undefined)}>Done</Btn>}><div className="market-stack market-mapping-evidence">
    <p><strong>Original buyer:</strong> {selected.sourceName}</p><p><strong>Status:</strong> {selected.status}</p><p><strong>Applied organization:</strong> {selected.organization}</p><p><strong>Proposed hierarchy:</strong> {selected.proposedHierarchy || 'Not established'}</p>
    {selected.participants && <p><strong>Named participants:</strong> {selected.participants}. Lead buyer and allocation are not established.</p>}<p>{selected.notes || 'Proposed from the source label; not individually verified.'}</p>
    <p>Historical effective dates are not established. A reference may support the category or parent relationship without verifying every office.</p>
    {selected.evidence.split('\n').filter(Boolean).map((url, i) => <a key={url} href={url} target="_blank" rel="noopener noreferrer">Source reference {i + 1}</a>)}
  </div></Modal>}</div>;
}
export function MarketAnalysis() {
  const location = usePluginLocation();
  const params = new URLSearchParams(location.split('?')[1]);
  const requested = location.split('?')[0].split('/')[2];
  const view: View = tabs.some(t => t.id === requested) ? requested as View : 'overview';
  const filters = { ...defaultFilters };
  for (const key of Object.keys(filters) as (keyof MarketFilters)[]) {
    const value = params.get(key);
    if (value !== null) (filters as any)[key] = typeof filters[key] === 'boolean' ? value === '1' : value;
  }
  // Old bookmarks used exact original buyer labels before grouping existed.
  if (params.has('buyer') && !params.has('buyerLevel')) filters.buyerLevel = 'source';
  if (!isBuyerLevel(filters.buyerLevel)) filters.buyerLevel = defaultFilters.buyerLevel;
  let trail: ReturnType<typeof parseBuyerTrail> = [];
  try { trail = parseBuyerTrail(filters.buyerTrail); } catch { /* Query reports the invalid link; reset remains available. */ }
  const options: MarketOptions = {};
  for (const key of ['year','dimension','metric','aFrom','aTo','bFrom','bTo'] as const) if (params.has(key)) (options as any)[key] = params.get(key);
  if (!['buyer','supplier','type'].includes(options.dimension ?? 'buyer')) options.dimension = 'buyer';
  if (!['value','count'].includes(options.metric ?? 'value')) options.metric = 'value';
  const state = { view, filters, options };
  let selection: { slice: Slice; title: string; filters: MarketFilters } | undefined;
  try { const value = JSON.parse(params.get('inspection') ?? 'null'); if (value && typeof value.title === 'string' && value.slice && value.filters) selection = { ...value, filters: inspectionFilters(value.filters) }; } catch { /* Malformed bookmarks do not open an inspection. */ }
  const setSelection = (next: typeof selection) => patchPluginQuery({ inspection: next ? JSON.stringify(next) : null }, 'push');
  const update = (next: typeof state, history?: 'push' | 'replace') => {
    const query = new URLSearchParams();
    for (const key of Object.keys(next.filters) as (keyof MarketFilters)[]) if (next.filters[key] !== defaultFilters[key] || key === 'buyerLevel' && !!next.filters.buyer) query.set(key, typeof next.filters[key] === 'boolean' ? next.filters[key] ? '1' : '0' : String(next.filters[key]));
    for (const [key, value] of Object.entries(next.options)) if (value !== undefined) query.set(key, String(value));
    navigatePlugin('/analysis/' + next.view + (query.size ? '?' + query : ''), history ?? (next.view === view ? 'replace' : 'push'));
  };
  const meta = useMarket<Metadata>('meta', { buyerLevel: filters.buyerLevel, buyerTrail: filters.buyerTrail });
  const query = useMarket<Overview | Trends | Distribution | Comparison | Matrix | Metadata | MappingOverview>(view, filters, options);
  const data = query.current ? query.data : undefined;
  const inspect: Inspect = (slice, title, override) => setSelection({ slice, title, filters: override ?? filters });
  const setOptions = (next: MarketOptions) => update({ ...state, options: next });
  const focus = (kind: 'buyer' | 'supplier', name: string) => update({ ...state, view: 'overview', filters: { ...filters, [kind]: name } });
  const explore = trail.length < 6 && nextBuyerLevel(filters.buyerLevel) ? (name: string, level: BuyerLevel) => update({ ...state, view: 'buyers', filters: { ...filters, buyer: '', buyerLevel: level, buyerTrail: JSON.stringify([...trail, { level: filters.buyerLevel, name }]) } }, 'push') : undefined;
  const resetScope = () => update({ ...state, filters: { ...filters, buyer: '', buyerTrail: '', buyerSearch: '' } }, 'push');
  const label = tabs.find(t => t.id === view)?.label ?? 'Overview';
  const setView = (next: View) => update({ ...state, view: next });
  // The header and filters are shared by every view; start each view from the top so they stay put.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.closest('.zoer-content')?.scrollTo({ top: 0 }); }, [view]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const active = activeFilters(filters);
  return <div ref={root} className="market-workspace">
    <ViewNav value={view} href={next => pluginHref("/analysis/" + next + (params.size ? "?" + params : ""))} onChange={setView} />
    <div className="market-main">
    <header className="market-header"><div>
      <h1 className="market-title">{label}</h1>
      <div className="market-view-picker"><Select aria-label="Analysis view" value={view} onChange={e => setView(e.target.value as View)}>{tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</Select></div>
      <p>{meta.data ? `${count(meta.data.count)} saved awards` : 'Reading saved awards…'}</p>
    </div><div className="market-actions">
      <Btn variant="secondary" size="sm" className="relative" aria-label={active ? `Filters, ${active} active` : 'Filters'} aria-haspopup="dialog" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" /><span className="market-action-label">Filters</span><CountBadge count={active} /></Btn>
      {/* Phones collapse these to icons (labels hidden in CSS); the accessible names stay. */}
      <Btn variant="secondary" size="sm" aria-label="Refresh" tooltip="Refresh" onClick={() => { meta.retry(); query.retry(); }}><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" /><span className="market-action-label">Refresh</span></Btn>
      <Btn size="sm" variant="secondary" aria-label="Matching awards" tooltip="Matching awards" onClick={() => inspect({}, 'Current market filters')}><List aria-hidden="true" className="h-3.5 w-3.5" /><span className="market-action-label">Matching awards</span></Btn></div></header>
    {filtersOpen && <FiltersDialog value={filters} meta={meta.data} apply={next => { update({ ...state, filters: next }); setFiltersOpen(false); }} close={() => setFiltersOpen(false)} />}
    {view !== 'quality' && view !== 'mapping' && <section className="market-buyer-controls" aria-label="Buyer hierarchy">
      <Choice label="Group buyers by" value={filters.buyerLevel} values={[...buyerLevels]} onChange={value => update({ ...state, filters: { ...filters, buyerLevel: value as BuyerLevel, buyer: '' } }, 'push')} />
      <div className="market-stack"><nav className="market-breadcrumbs" aria-label="Buyer scope"><Btn size="sm" variant="ghost" onClick={resetScope}>All buyers</Btn>{trail.map((scope, i) => <span key={i}> / <Btn size="sm" variant="ghost" onClick={() => update({ ...state, filters: { ...filters, buyer: '', buyerLevel: trail[i + 1]?.level ?? filters.buyerLevel, buyerTrail: JSON.stringify(trail.slice(0, i + 1)) } }, 'push')}>{scope.name}</Btn></span>)}{filters.buyer && <span> / {filters.buyer}</span>}</nav>
      <p className="market-caption">Grouping: {buyerLevels.find(l => l.value === filters.buyerLevel)?.label}. Proposed mapping {BUYER_MAPPING_VERSION}; ambiguous buyers stay separate. Explore opens the next distinct subdivision; buyers without subdivisions open their awards.</p>
      {!!filters.buyerTrail && <Btn size="sm" variant="secondary" onClick={() => { const previous = trail.at(-1); update({ ...state, filters: { ...filters, buyer: '', buyerLevel: previous?.level ?? defaultFilters.buyerLevel, buyerTrail: trail.length > 1 ? JSON.stringify(trail.slice(0, -1)) : '' } }, 'push'); }}>Up one level</Btn>}
      </div></section>}
    {view === 'compare' && <ComparisonControls options={options} change={setOptions} />}
    {(query.error || meta.error) && <div role="alert" className="market-error">{query.error ?? meta.error}<button type="button" onClick={() => { meta.retry(); query.retry(); }}>Retry analysis</button></div>}
    <section id="market-analysis-panel" aria-labelledby={`market-analysis-tab-${view}`} className="market-stack">
      {!data && !query.error && <p role="status" className="market-loading">Loading {label.toLowerCase()}…</p>}
      {data && <>
        {view === 'overview' && <OverviewView data={data as Overview} currency={filters.currency} inspect={inspect} />}
        {(view === 'buyers' || view === 'suppliers') && <EntityView key={view} filters={filters} data={data as Overview} kind={view === 'buyers' ? 'buyer' : 'supplier'} currency={filters.currency} inspect={inspect} focus={name => focus(view === 'buyers' ? 'buyer' : 'supplier', name)} explore={view === 'buyers' ? explore : undefined} />}
        {view === 'trends' && meta.data && <TrendsView data={data as Trends} currency={filters.currency} options={options} change={setOptions} meta={meta.data} inspect={inspect} />}
        {view === 'sizes' && <SizesView data={data as Distribution} currency={filters.currency} inspect={inspect} />}
        {view === 'compare' && <CompareView data={data as Comparison} options={options} change={setOptions} filters={filters} inspect={inspect} />}
        {(view === 'mix' || view === 'relationships') && <MatrixView key={view} data={data as Matrix} kind={view} currency={filters.currency} inspect={inspect} />}
        {view === 'mapping' && <MappingView data={data as MappingOverview} />}
        {view === 'quality' && <QualityView data={data as Metadata} inspect={inspect} />}
      </>}
    </section>
    </div>
    {selection && <Records selection={selection} close={() => setSelection(undefined)} />}
  </div>;
}
