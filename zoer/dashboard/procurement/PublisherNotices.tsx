import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Btn, Field, Select } from '@zoer/plugin-ui/controls';
import { useCapabilities } from '../capabilities';
import { hasNativeHost, host } from '../bridge';
import { patchPluginQuery } from '../navigation';
import { shortDate } from './deadline';
import { checkPublisherFiles, importPublisherFile, markPublisherReviewed, openPublisherDownload } from './publisher-downloads';
import { publisherSignInOrigin, type PublisherOutcome, type PublisherReceipt } from './publisher-receipts';
import { safeSourceUrl } from './catalog';
import { readPublisherDeadlines, savePublisherDeadline, type PublisherDeadline } from './publisher-deadlines';
import { publisherDeadlinesDiffer, publisherLink, resolvedPublisherLinks, type PublisherLink } from './publisher-links';

type NoticeFile = { id: string; name: string; status: string };

export function PublisherNotices({ id, data, receipt, documents = [], evidence }: {
  id: string;
  data: Parameters<typeof resolvedPublisherLinks>[0] & { closingAt?: string; closingDate?: string; status?: string };
  receipt?: PublisherReceipt | null;
  documents?: NoticeFile[];
  evidence: boolean;
}) {
  const links = resolvedPublisherLinks(data, receipt);
  const matchReview = receipt?.outcomes.find(item => item.matchReview && item.review);
  const client = useQueryClient();
  const { collection } = useCapabilities();
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const deadlineKey = ['catalog', 'publisher-deadlines', id];
  const deadlines = useQuery({
    queryKey: deadlineKey, queryFn: () => readPublisherDeadlines(id),
    enabled: links.some(link => link.label === 'Bonfire' && link.kind === 'notice'),
  });
  if (!links.length && !matchReview) return null;
  const refresh = async () => {
    setBusy(true); setError(''); setStatus('');
    try {
      const result = await checkPublisherFiles(id);
      await client.invalidateQueries({ queryKey: ['catalog'] });
      const refreshed = result.outcomes.filter(item => item.state === 'refreshed').length;
      setStatus(refreshed ? `Updated ${refreshed} publisher ${refreshed === 1 ? 'notice' : 'notices'}.` : 'Publisher check complete. See the status below each link.');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="pc-card" aria-label="Publisher notices">
    <header><h3>Publisher notices</h3>{collection && links.length > 0 && <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void refresh()}>{busy ? 'Checking publishers…' : receipt ? 'Retry publisher check' : 'Check publishers for files'}</Btn>}</header>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    {deadlines.error && <p role="status">Could not look up the saved Bonfire deadline. <button type="button" className="pc-link-btn" onClick={() => void deadlines.refetch()}>Retry</button></p>}
    {matchReview && <PublisherMatchReview id={id} outcome={matchReview} canReview={collection && evidence} />}
    {links.map(link => <PublisherNotice key={link.recordId ?? link.url} id={id} link={link}
      outcome={receipt?.outcomes.find(item => item.url === link.url)} upload={collection && evidence}
      bcDeadline={data.closingAt ?? data.closingDate} bcStatus={data.status}
      bonfireDeadline={deadlines.data?.find(item => item.url === link.url)} editDeadline={!!deadlines.data && collection && evidence && hasNativeHost()}
      documents={documents} onSaveDeadline={() => client.invalidateQueries({ queryKey: deadlineKey })} />)}
  </section>;
}

function PublisherMatchReview({ id, outcome, canReview }: { id: string; outcome: PublisherOutcome; canReview: boolean }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const review = outcome.review;
  const candidates = (outcome.candidates ?? []).map(publisherLink).filter(link => link?.kind === 'notice');
  const complete = async () => {
    if (!review || busy) return;
    setBusy(true); setError('');
    try {
      await markPublisherReviewed(id, outcome.url, review.evidence);
      await client.invalidateQueries({ queryKey: ['catalog'] });
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="pc-notice-section">
    <p><strong>{review?.reviewedAt ? 'Publisher match reviewed' : 'Publisher match needs review'}</strong></p>
    <p>{outcome.message}</p>
    {candidates.length > 0 && <ul>{candidates.map(link => link && <li key={link.url}><a className="procurement-link" href={link.url} target="_blank" rel="noopener noreferrer">{new URL(link.url).hostname}{new URL(link.url).pathname} ↗</a></li>)}</ul>}
    {canReview && review && !review.reviewedAt && <Btn size="sm" variant="secondary" disabled={busy} onClick={() => void complete()}>Mark match reviewed</Btn>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

function PublisherNotice({ id, link, outcome, upload, bcDeadline, bcStatus, bonfireDeadline, editDeadline, documents, onSaveDeadline }: {
  id: string; link: PublisherLink; outcome?: PublisherOutcome; upload: boolean; bcDeadline?: string; bcStatus?: string;
  bonfireDeadline?: PublisherDeadline; editDeadline: boolean; documents: NoticeFile[]; onSaveDeadline(): Promise<void>;
}) {
  const [openingPasswords, setOpeningPasswords] = useState(false);
  const [passwordsError, setPasswordsError] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const client = useQueryClient();
  const review = outcome?.review;
  const signInOrigin = publisherSignInOrigin(link);
  const openPasswords = async () => {
    if (openingPasswords) return;
    setOpeningPasswords(true);
    setPasswordsError('');
    try {
      await openPublisherDownload(id, link);
    } catch (error) {
      setPasswordsError((error as Error).message);
    } finally {
      setOpeningPasswords(false);
    }
  };
  const recordId = outcome?.recordId ?? link.recordId;
  const detail = useQuery({
    queryKey: ['catalog', 'procurement-detail', recordId],
    enabled: !!recordId,
    queryFn: () => host('catalog.record', { id: recordId! }),
  });
  const saved = detail.data?.record?.data;
  const url = (recordId && safeSourceUrl(saved?.detailUrl)) || link.url;
  const deadline = saved?.closingAt ?? saved?.closingDate;
  const publisherDate = saved?.closingDate || (deadline && shortDate(deadline, 0, false).text);
  const status = typeof saved?.status === 'string' ? saved.status.trim() : '';
  const deadlineDiffers = publisherDeadlinesDiffer(bcDeadline, deadline);
  const a = bcStatus?.trim().toLowerCase(), b = status.toLowerCase();
  const statusDiffers = a && a !== 'unknown' && b && b !== 'unknown' && a !== b;
  const questions = Array.isArray(saved?.sourceFields) ? saved.sourceFields.find((field: { label?: string }) => field?.label === 'Question Deadline')?.value : undefined;
  const completeReview = async () => {
    if (!review || reviewing) return;
    setReviewing(true); setReviewError('');
    try {
      await markPublisherReviewed(id, link.url, review.evidence);
      await client.invalidateQueries({ queryKey: ['catalog'] });
    } catch (error) { setReviewError((error as Error).message); }
    finally { setReviewing(false); }
  };
  return <div className="pc-notice-section">
    <p><a className="procurement-link" href={url} target="_blank" rel="noopener noreferrer">{(recordId || link.kind === 'notice') ? `Open on ${link.label}` : `Search ${link.label} portal`} ↗</a></p>
    {link.kind === 'portal' && !recordId && <p className="pc-card-meta">BC Bid links to the buyer’s listing. Search by the opportunity number.</p>}
    {outcome?.message && <p className="pc-card-meta">{outcome.message}</p>}
    {review && <p className="pc-card-meta">{review.reviewedAt ? 'Review complete' : `Needs review · ${new URL(signInOrigin).hostname}`}</p>}
    {upload && <div>
      <Btn size="sm" variant={link.kind === 'notice' && hasNativeHost() ? 'primary' : 'secondary'} disabled={openingPasswords} onClick={() => void openPasswords()}>{link.kind === 'notice' && hasNativeHost() ? 'Download publisher files' : 'Open Zoer Passwords'}</Btn>
      {passwordsError && <p role="alert">{passwordsError}</p>}
    </div>}
    {upload && (link.kind === 'notice' || recordId) && (hasNativeHost()
      ? <PublisherFileImport id={id} link={link} />
      : <p className="pc-card-meta">File import is available in the native Procurement workspace.</p>)}
    {upload && review && !review.reviewedAt && <div>
      <Btn size="sm" variant="secondary" disabled={reviewing} onClick={() => void completeReview()}>Mark reviewed</Btn>
      {reviewError && <p role="alert">{reviewError}</p>}
    </div>}
    {link.label === 'Bonfire' && link.kind === 'notice' && <>
      {bonfireDeadline && <>
        {publisherDeadlinesDiffer(bcDeadline, bonfireDeadline.closingDate) && <p><strong>Sources report different deadlines.</strong> Check the publisher page for updates.</p>}
        <dl className="pc-facts">
          <div><dt>BC Bid · saved</dt><dd>{bcDeadline ? shortDate(bcDeadline, 0, false).text : 'No date captured'}</dd></div>
          <div><dt>Bonfire · {bonfireDeadline.evidence}</dt><dd>{shortDate(bonfireDeadline.closingDate, 0, false).text}</dd></div>
        </dl>
      </>}
      {editDeadline && <BonfireDeadlineForm key={bonfireDeadline?.savedAt ?? 'new'} id={id} url={link.url} saved={bonfireDeadline}
        documents={documents.filter(doc => doc.status === 'downloaded' && doc.name.startsWith('Bonfire - '))} onSaved={onSaveDeadline} />}
    </>}
    {recordId && (detail.isPending ? <p className="pc-card-meta" role="status">Checking for a saved publisher notice…</p>
      : detail.error ? <p className="pc-card-meta" role="status">Could not look up the saved publisher notice. <button type="button" className="pc-link-btn" onClick={() => void detail.refetch()}>Retry</button></p>
      : saved ? <>
        {(deadlineDiffers || statusDiffers) && <p><strong>{deadlineDiffers && statusDiffers ? 'Sources report different deadlines and statuses.' : deadlineDiffers ? 'Sources report different deadlines.' : 'Sources report different statuses.'}</strong> Check the publisher page for updates.</p>}
        <dl className="pc-facts">
          <div><dt>BC Bid · saved</dt><dd>{[bcDeadline && shortDate(bcDeadline, 0, false).text, bcStatus].filter(Boolean).join(' · ') || 'No date or status captured'}</dd></div>
          <div><dt>{link.label} · saved</dt><dd>{[publisherDate, status].filter(Boolean).join(' · ') || 'No date or status captured'}</dd></div>
          {questions && <div><dt>Publisher question deadline</dt><dd>{questions}</dd></div>}
          {(Number.isSafeInteger(saved.documentsCount) || Number.isSafeInteger(saved.addendaCount)) && <div><dt>Files listed by publisher</dt><dd>{[Number.isSafeInteger(saved.documentsCount) ? `${saved.documentsCount} documents` : '', Number.isSafeInteger(saved.addendaCount) ? `${saved.addendaCount} addenda` : ''].filter(Boolean).join(' · ')}</dd></div>}
        </dl>
        <p><button type="button" className="pc-link-btn" onClick={() => patchPluginQuery({ notice: recordId }, 'push')}>Open saved {link.label} record</button></p>
      </> : <p className="pc-card-meta">No saved publisher record. Open the publisher page for its details and documents.</p>)}
  </div>;
}

function BonfireDeadlineForm({ id, url, saved, documents, onSaved }: {
  id: string; url: string; saved?: PublisherDeadline; documents: NoticeFile[]; onSaved(): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [closingDate, setClosingDate] = useState(saved?.closingDate ?? '');
  const [evidence, setEvidence] = useState(saved?.evidence ?? '');
  const [documentId, setDocumentId] = useState(saved?.documentId ?? '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!editing) return <Btn type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>{saved ? 'Edit Bonfire deadline' : 'Record Bonfire deadline'}</Btn>;
  return <form className="pc-notice-section" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (documentId && !documents.some(doc => doc.id === documentId)) throw Error('Choose an attached Bonfire file or clear the selection.');
      await savePublisherDeadline(id, { url, closingDate, evidence, ...(documentId ? { documentId } : {}) }, saved);
      await onSaved();
      setEditing(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }}>
    <Field label="Bonfire closing date" type="date" required value={closingDate} disabled={busy} onChange={setClosingDate} />
    <Field label="Deadline source" required placeholder="e.g. Addendum 1" value={evidence} disabled={busy} onChange={setEvidence} />
    {documents.length > 0 && <label>Attached evidence <Select value={documentId} disabled={busy} onChange={event => setDocumentId(event.target.value)}>
      <option value="">Choose a file (optional)</option>
      {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.name}</option>)}
    </Select></label>}
    {error && <p role="alert">{error}</p>}
    <div className="procurement-actions">
      <Btn type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save Bonfire deadline'}</Btn>
      <Btn type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</Btn>
    </div>
  </form>;
}

function PublisherFileImport({ id, link }: { id: string; link: PublisherLink }) {
  const input = useRef<HTMLInputElement>(null);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false), [preview, setPreview] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState('');
  const save = async (files: File[]) => {
    if (!files.length || busy) return;
    setBusy(true); setStatus(''); setError('');
    let saved = 0, existing = 0;
    try {
      for (const file of files) {
        if (await importPublisherFile(id, link.label, file, preview) === 'saved') saved++;
        else existing++;
      }
    } catch (e) { setError((e as Error).message); }
    finally {
      if (saved || existing) setStatus(`${saved} ${saved === 1 ? 'file' : 'files'} verified and saved · ${existing} already saved.`);
      await client.invalidateQueries({ queryKey: ['catalog'] });
      setBusy(false);
    }
  };
  return <div className="pc-notice-section">
    <p className="pc-card-meta">Download through the publisher portal, then add the files here. Upload individual files to make their contents available for review.</p>
    <label><input type="checkbox" checked={preview} disabled={busy} onChange={event => setPreview(event.currentTarget.checked)} /> These files are publisher previews</label>
    <input ref={input} type="file" multiple hidden onChange={event => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = '';
      void save(files);
    }} />
    <Btn size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Verifying files…' : `Add ${link.label} files`}</Btn>
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
  </div>;
}
