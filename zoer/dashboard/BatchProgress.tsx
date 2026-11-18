import { useEffect, useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { fileSize } from './file-size';
import { isExtractionBatch } from './document-processing';
import { useDocumentQueue } from './document-queue';

function PacingCountdown({until}:{until:number}) {
  const left = () => Math.max(0, Math.ceil((until-Date.now())/1000));
  const [seconds,setSeconds]=useState(left);
  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((until-Date.now())/1000));
      setSeconds(remaining);
      if (!remaining) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [until]);
  return seconds ? <span aria-hidden="true"> · {seconds}s</span> : null;
}

export function BatchProgress({batches, tasks = [], onSkip, showSize = true}: {
  batches:any[]; tasks?:any[]; showSize?:boolean; onSkip?:(taskId:string, transferId:string)=>Promise<void>;
}) {
  const [pending,setPending] = useState(''), [error,setError] = useState('');
  const active = batches.find(batch => batch.status === 'running' && batch.kind === 'download')
    ?? batches.find(batch => batch.status === 'running');
  const input = active ? JSON.parse(active.input || '{}') : {};
  const queue = useDocumentQueue(input.queueScope === 'all' ? 'all' : 'open', {
    enabled: !!input.queueScope, running: true, asOf: input.scopeAt,
  });
  if (!active) return null;
  const task = tasks.find(task => task.run_id === active.id && ['running','skipping'].includes(task.status));
  const skip = async () => {
    setPending(task.transferId); setError('');
    try { await onSkip!(task.id,task.transferId); }
    catch (e) { setError((e as Error).message); setPending(''); }
  };
  const skipping = task && (task.status === 'skipping' || pending === task.transferId);
  return <section className="zoer-history research-progress" aria-label="Current processing">
    <strong>{queue.data ? `${queue.data.saved.toLocaleString()} of ${queue.data.files.toLocaleString()} linked files saved` : <>{active.kind==='review'?'AI review in progress':isExtractionBatch(active)?'Text extraction in progress':'Attachment download in progress'} · {active.completed}/{active.total} records complete</>}</strong>
    {queue.data && <p>{queue.data.fullySaved} of {queue.data.withLinks} opportunities complete</p>}
    {task && <p role="status">{task.phase || task.kind} · {task.name || task.record_id}
      {showSize && task.receivedBytes > 0 ? ` · ${fileSize(task.receivedBytes)} received${task.expectedBytes > 0 ? ` of ${fileSize(task.expectedBytes)}` : ''}`
        // While a file downloads its size is shown, also when the source did not say ("Size unknown").
        : showSize && (task.expectedBytes > 0 || task.phase === 'Downloading') ? ` · ${fileSize(task.expectedBytes)}` : ''}
      {task.resumeAt && <PacingCountdown key={task.resumeAt} until={task.resumeAt} />}
    </p>}
    {task?.transferId && onSkip && <Button variant="ghost" disabled={skipping} onClick={() => void skip()}>{skipping ? 'Skipping…' : 'Skip file'}</Button>}
    {error && <p role="alert">{error}</p>}
    <p className="research-note">Progress is saved, so you can leave this page.</p>
  </section>;
}
