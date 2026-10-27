import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Select } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { navigatePlugin, usePluginLocation } from '../navigation';
import { taxonomyNodesQuery, taxonomyChangesQuery, taxonomyFilter, taxonomyPredicate, termId, type TaxonomyTerm } from './taxonomy-contract';
import './taxonomy.css';
import { HistoricalReference } from './Historical';

const readData = (row: any) => ({ ...row, data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data });
const run = async (statement: string, parameters: (string | number)[] = []) => (await host('catalog.query', { statement, parameters })).rows;
export function Taxonomy() {
  const location = usePluginLocation(), params = new URLSearchParams(location.split('?')[1] || '');
  const releases = useQuery({ queryKey: ['catalog', 'taxonomy', 'releases'], queryFn: async () => (await run("SELECT id,data FROM records WHERE kind='taxonomy-release' AND json_extract(data,'$.status')='ready' ORDER BY id DESC LIMIT 50")).map(readData) });
  const version = params.get('version') || releases.data?.[0]?.data.version || '', code = params.get('code') || '';
  const valid = /^UNv[0-9]{6}$/.test(version) && (!code || /^[0-9]{8}$/.test(code));
  const [search, setSearch] = useState(''), [after, setAfter] = useState(''), [previous, setPrevious] = useState<string[]>([]);
  useEffect(() => { setAfter(''); setPrevious([]); }, [version, code, search]);
  const choose = (code = '', selected = version) => { setSearch(''); navigatePlugin('/taxonomy?' + new URLSearchParams({ version: selected, ...(code ? { code } : {}) })); };
  const currentRelease = releases.data?.find((row: any) => row.data.version === version);
  const selected = useQuery({ queryKey: ['catalog', 'taxonomy', 'term', version, code], enabled: valid && !!code, queryFn: async () => (await host('catalog.read', { ids: [termId(version, code)] })).records[0] as { id: string; data: TaxonomyTerm } | undefined });
  const nodes = useQuery({ queryKey: ['catalog', 'taxonomy', 'nodes', version, code, search, after], enabled: valid && !!currentRelease, queryFn: async () => {
    const query = taxonomyNodesQuery(version, code, search, after);
    return (await run(query.statement, query.parameters)).map(readData) as { id: string; data: TaxonomyTerm }[];
  } });
  const coverage = useQuery({ queryKey: ['catalog', 'taxonomy', 'coverage', version, code], enabled: valid && !!code && !!selected.data, queryFn: async () => {
    const query = taxonomyPredicate(taxonomyFilter(version, code));
    return Number((await run(`SELECT count(*) AS total FROM records WHERE kind='opportunity' AND ${query.sql}`, query.parameters))[0]?.total || 0);
  } });
  const changes = useQuery({ queryKey: ['catalog', 'taxonomy', 'changes', version, code], enabled: valid && !!currentRelease, queryFn: () => { const q = taxonomyChangesQuery(version, code); return run(q.statement, q.parameters); } });
  const changeDetails = useQuery({ queryKey: ['catalog', 'taxonomy', 'change-details', version, code], enabled: valid && !!code && !!currentRelease, queryFn: async () => { const q = taxonomyChangesQuery(version, code, false); return (await run(q.statement, q.parameters)).map(readData); } });
  const refresh = () => {
    const requests: Promise<unknown>[] = [releases.refetch()];
    if (valid && currentRelease) requests.push(nodes.refetch(), changes.refetch());
    if (valid && code) requests.push(selected.refetch());
    if (valid && code && currentRelease) requests.push(changeDetails.refetch());
    if (valid && code && selected.data) requests.push(coverage.refetch());
    void Promise.all(requests);
  };
  const rows = (nodes.data || []).slice(0, 50), more = (nodes.data?.length || 0) > 50, term = selected.data?.data;
  return <section className="pc-taxonomy" aria-label="Commodity taxonomy">
    <header><h1>Commodity taxonomy</h1><Btn variant="secondary" onClick={refresh}>Refresh</Btn></header>
    {releases.isPending ? <p role="status">Loading taxonomy releases…</p> : releases.error ? <p role="alert">{releases.error.message}</p> : !releases.data?.length ? <p>No taxonomy release has been imported.</p> : <>
      <div className="pc-taxonomy-tools"><label>Release<Select aria-label="Taxonomy release" value={version} onChange={event => choose('', event.target.value)}>{releases.data.map((row: any) => <option key={row.id} value={row.data.version}>UNSPSC {row.data.version}</option>)}</Select></label><input aria-label="Search commodity taxonomy" placeholder="Search codes or names…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      {!valid && <p role="alert">Invalid taxonomy code or release.</p>}
      <nav aria-label="Commodity hierarchy"><button type="button" onClick={() => choose()}>All segments</button>{term && [...term.ancestors, term].map(node => <button key={node.code} type="button" aria-current={node.code === code ? 'page' : undefined} onClick={() => choose(node.code)}>{node.code} · {node.title}</button>)}</nav>
      {selected.error && <p role="alert">{selected.error.message}</p>}
      {code && !selected.isPending && !term && <p>This code isn’t in the selected release.</p>}
      {term && <section className="pc-taxonomy-term" aria-label="Selected commodity code"><h2>{term.code} · {term.title}</h2><p>{term.level} · {version}</p>{term.definition && <p>{term.definition}</p>}{coverage.error ? <p role="alert">Could not count linked opportunities: {coverage.error.message}</p> : <Btn variant="secondary" disabled={coverage.isPending} onClick={() => navigatePlugin('/procurement?' + new URLSearchParams({ kind: 'opportunity', classification: taxonomyFilter(version, code) }))}>View {coverage.data?.toLocaleString() ?? '…'} opportunities</Btn>}</section>}
      {!valid || !currentRelease ? null : nodes.error ? <p role="alert">{nodes.error.message}</p> : nodes.isPending ? <p role="status">Loading commodity codes…</p> : <><ul className="pc-taxonomy-list">{rows.map(row => <li key={row.id}><button type="button" onClick={() => choose(row.data.code)}><strong>{row.data.code}</strong><span>{row.data.title}</span><small>{row.data.level}</small></button></li>)}</ul>{!rows.length && <p>{search ? 'No matching codes.' : 'No child codes.'}</p>}<div className="pc-taxonomy-pages"><Btn variant="secondary" disabled={!previous.length} onClick={() => { setAfter(previous.at(-1)!); setPrevious(previous.slice(0, -1)); }}>Previous</Btn><Btn variant="secondary" disabled={!more} onClick={() => { setPrevious([...previous, after]); setAfter(rows.at(-1)!.id); }}>Next</Btn></div></>}
      {currentRelease && <details><summary data-zoer-disclosure>Release source and changes</summary><p>{currentRelease.data.terms.toLocaleString()} terms · previous version {currentRelease.data.previousVersion}</p>{changes.error ? <p role="alert">Could not load changes: {changes.error.message}</p> : changes.isPending ? <p role="status">Loading changes…</p> : <p>{(changes.data || []).map((row: any) => `${row.type}: ${row.total}`).join(' · ') || 'No recorded changes for this code.'}</p>}{changeDetails.error && <p role="alert">{changeDetails.error.message}</p>}{(changeDetails.data || []).slice(0, 50).map((row: any) => <article key={row.id}><h3>{row.data.change_type} · {row.data.effective_code || row.data.changed_code}</h3>{row.data.changed_code && <p>Previous: {row.data.changed_code} · {row.data.changed_title}</p>}{row.data.effective_code && <p>Current: {row.data.effective_code} · {row.data.effective_title}</p>}{row.data.effective_definition && <p>{row.data.effective_definition}</p>}<small>{row.data.sourceSheet} · source row {row.data.sourceRow}</small></article>)}{(changeDetails.data?.length || 0) > 50 && <p>Showing the first 50 changes for this code.</p>}<p>The earlier version is represented by the supplied change log; its complete taxonomy is not imported.</p><a href={currentRelease.data.provenance.sourceUrl} target="_blank" rel="noopener noreferrer">Official source workbook ↗</a><p className="pc-taxonomy-hash">SHA-256: {currentRelease.data.provenance.sourceSha256}</p></details>}
    </>}
    <HistoricalReference />
  </section>;
}

/** Opportunity links resolve the shared term; raw source labels remain in the notice. */
export function NoticeTaxonomy({ id, fingerprint }: { id: string; fingerprint?: string }) {
  const links = useQuery({ queryKey: ['catalog', 'taxonomy', 'notice', id, fingerprint], enabled: !!fingerprint, queryFn: async () => {
    const rows = await run("SELECT t.id,t.data,json_extract(l.data,'$.role') AS role,json_extract(l.data,'$.rawLabel') AS rawLabel FROM records l JOIN records t ON t.id=json_extract(l.data,'$.termId') WHERE l.kind='opportunity-classification' AND t.kind='taxonomy-term' AND json_extract(l.data,'$.recordId')=? AND json_extract(l.data,'$.inputFingerprint')=? ORDER BY t.id LIMIT 101", [id, fingerprint!]);
    if (rows.length > 100) throw Error('Too many commodity links to display.');
    return rows.map(readData);
  } });
  if (!fingerprint) return null;
  return <section className="pc-taxonomy-notice" aria-label="Commodity classifications"><h3>Commodity classifications</h3>{links.error ? <p role="alert">{links.error.message}</p> : links.isPending ? <p role="status">Loading classifications…</p> : !links.data?.length ? <p>No verified commodity codes.</p> : <ul>{links.data.map((row: any) => <li key={row.id}><button type="button" onClick={() => navigatePlugin('/taxonomy?' + new URLSearchParams({ version: row.data.version, code: row.data.code }))}>{row.data.code} · {row.data.title}</button><small>{row.role === 'unspecified' ? 'Role not stated' : row.role === 'main' ? 'Main commodity' : 'Other commodity'} · {row.data.version}</small><p>{row.data.ancestors.map((node: any) => `${node.code} ${node.title}`).join(' → ')}</p></li>)}</ul>}</section>;
}
