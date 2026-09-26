import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Modal } from '@zoer/plugin-ui/controls';
import { host } from '../bridge';
import { setStar } from '../backend';
import { navigatePlugin } from '../navigation';
import { deadlineLabel, safeSourceUrl, sourceId } from './catalog';
import { readProcurementState, saveProcurementState } from './state-client';
import { shortDate, sourceName } from './display';

/** One notice: what it is, where it came from, and what you can do with it next. */
export function NoticeDetail({ id, onClose, onEvidence }: { id: string; onClose(): void; onEvidence(ids: string[]): void }) {
  const client = useQueryClient();
  const detail = useQuery({ queryKey: ['catalog', 'procurement-detail', id], queryFn: () => host('catalog.record', { id }) });
  const state = useQuery({ queryKey: ['catalog', 'procurement-state'], queryFn: readProcurementState });
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const record = detail.data?.record, data = record?.data ?? {};
  const source = sourceId(data), award = record?.kind === 'award';
  const pursuit = state.data?.pursuits.find(item => item.recordId === id);
  const url = safeSourceUrl(data.detailUrl || data.sourceUrl);
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name); setError('');
    try { await fn(); await client.invalidateQueries({ queryKey: ['catalog'] }); } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  };
  const fields: [string, unknown][] = [
    ['Buyer', data.issuedBy || data.issuingOrganization], ['Status', data.status],
    ['Reference', data.externalId || data.opportunityId],
    [award ? 'Award date' : 'Closes', award ? shortDate(data.awardDate).text : shortDate(data.closingAt ?? data.closingDate).text],
    ...(award ? [['Supplier', data.successfulSupplier] as [string, unknown]] : []),
    ['Imported', data.importedAt ? shortDate(data.importedAt).text : ''],
  ];
  return <Modal title={record?.title ?? 'Notice'} mobileSheet onClose={onClose}>
    {detail.isPending && <p role="status">Loading notice…</p>}
    {detail.error && <p role="alert">{detail.error.message}</p>}
    {record && <div className="procurement-detail">
      <p className="pc-detail-meta">{sourceName(source)} · {award ? 'Award' : 'Opportunity'}{url && <> · <a className="procurement-link" href={url} target="_blank" rel="noopener noreferrer">Open on {sourceName(source)} ↗</a></>}</p>
      <div className="procurement-actions">
        <Btn variant="secondary" disabled={!!busy} aria-pressed={!!data.starred} onClick={() => void act('star', () => setStar(record.kind, award ? data.importKey : data.sourceKey, !data.starred))}>{busy === 'star' ? 'Saving…' : data.starred ? '★ Shortlisted' : '☆ Shortlist'}</Btn>
        {pursuit
          ? <Btn variant="secondary" onClick={() => { onClose(); navigatePlugin('/pursuits'); }}>In pursuits · {pursuit.stage}</Btn>
          : <Btn variant="secondary" disabled={!!busy || state.isPending || !!state.error} onClick={() => void act('pursuit', () => saveProcurementState({ operation: 'pursuit.upsert', recordId: id, sourceId: source, stage: 'Watching', notes: '', expectedVersion: 0 }))}>{busy === 'pursuit' ? 'Adding…' : 'Add to pursuits'}</Btn>}
        <Btn variant="secondary" onClick={() => onEvidence([id])}>Analyze evidence</Btn>
        {source === 'bc-bid' && <Btn variant="secondary" onClick={() => { onClose(); navigatePlugin('/documents?record=' + encodeURIComponent(id) + '&kind=' + record.kind); }}>Documents & AI</Btn>}
      </div>
      {error && <p role="alert">{error}</p>}
      <dl>{fields.filter(([, value]) => value && value !== 'No date').map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={label === 'Closes' ? deadlineLabel(data.closingAt ?? data.closingDate) : undefined}>{String(value)}</dd></div>)}</dl>
      <p className="procurement-description">{data.sourceDescriptionText || data.descriptionText || data.opportunityDescription || 'No description saved.'}</p>
      <p className="procurement-coverage">{detail.data.documents.length} downloaded documents · {detail.data.reviews.length} saved reviews{source !== 'bc-bid' ? ' · Document download is only available for BC Bid.' : ''}</p>
      {(data.sourceFileName || data.sourceFileSha256) && <details><summary>Import file</summary><dl><div><dt>File</dt><dd>{data.sourceFileName || 'Not recorded'}</dd></div><div><dt>SHA-256</dt><dd>{data.sourceFileSha256 || 'Not recorded'}</dd></div></dl></details>}
    </div>}
  </Modal>;
}
