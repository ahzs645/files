import { useState } from 'react';
import { Btn } from '@zoer/plugin-ui/controls';
import { runProcurementAction } from './state-client';
import { ScheduleControl } from './ScheduleControl';

export function AlertSettings() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const check = async () => {
    setBusy(true); setError(''); setMessage('');
    try { await runProcurementAction('procurement.alerts', {}); setMessage('Saved-search check finished. Delivery receipts are retained in the catalog.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <section className="procurement-workflow" aria-label="Saved-search alerts">
    <header><h2>Alerts</h2><p>Get a Zoer notification when a saved search has new or changed results.</p></header>
    <ScheduleControl actionId="procurement.alerts" input={{}} title="Alert checks" />
    <div className="procurement-actions"><Btn variant="secondary" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check alerts now'}</Btn></div>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
