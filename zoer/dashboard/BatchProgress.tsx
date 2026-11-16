import { useState } from 'react';
import { Button } from '../../apps/dashboard/src/components/ui/Button';
import { fileSize } from './file-size';

export function BatchProgress({batches, tasks = [], onSkip, showSize = true}: {
  batches:any[]; tasks?:any[]; showSize?:boolean; onSkip?:(taskId:string, transferId:string)=>Promise<void>;
}) {
  const [pending,setPending] = useState(''), [error,setError] = useState('');
  const active = batches.find(batch => batch.status === 'running' && batch.kind === 'download')
    ?? batches.find(batch => batch.status === 'running');
  if (!active) return null;
  const task = tasks.find(task => task.run_id === active.id && ['running','skipping'].includes(task.status));
  const skip = async () => {
    setPending(task.transferId); setError('');
    try { await onSkip!(task.id,task.transferId); }
    catch (e) { setError((e as Error).message); setPending(''); }
  };
  const skipping = task && (task.status === 'skipping' || pending === task.transferId);
  return <section className="zoer-history research-progress" aria-label="Current processing">
    <strong>{active.kind==='review'?'AI review in progress':'Document processing in progress'} · {active.completed}/{active.total} records complete</strong>
    {task && <p role="status">{task.phase || task.kind} · {task.name || task.record_id}{showSize && task.phase === 'Downloading' && ` · ${fileSize(task.expectedBytes)}`}{showSize && task.receivedBytes > 0 && ` · ${fileSize(task.receivedBytes)} received`}</p>}
    {task?.transferId && onSkip && <Button variant="ghost" disabled={skipping} onClick={() => void skip()}>{skipping ? 'Skipping…' : 'Skip file'}</Button>}
    {error && <p role="alert">{error}</p>}
    <p className="research-note">Progress is saved, so you can leave this page.</p>
  </section>;
}
