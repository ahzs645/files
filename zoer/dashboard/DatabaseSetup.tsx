import { useState } from 'react';
import { Btn } from '@zoer/plugin-ui/controls';
import { setUpDatabase, type DatabaseSetup as SetupState } from './backend';

/**
 * Shown in place of the workspace while this install's catalog has not been set up, so no page
 * reads or prepares tables first. Setup is the plugin's own `catalog.migrate` action; it only
 * runs when the user presses the button.
 */
export function DatabaseSetup({ setup }: { setup: SetupState }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const start = async () => {
    setBusy(true); setError('');
    try { await setUpDatabase(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Setup could not start.'); }
    finally { setBusy(false); }
  };
  const failure = error || setup.lastError;
  return <section className="pc-setup" aria-labelledby="pc-setup-title">
    <h2 id="pc-setup-title">Set up the Procurement database</h2>
    <p>Procurement keeps notices, documents, pursuits and reviews in its own database in Zoer. This install hasn’t set it up yet.</p>
    {setup.readOnly
      ? <p>This copy is read-only. Open Procurement in Zoer to set up its database.</p>
      : <p>Setup prepares that database and moves in any records and run history this plugin already saved. Source files are kept.</p>}
    {setup.blocked && <p role="status">{setup.blocked}</p>}
    {failure && <p role="alert" className="pc-setup-error">{error ? 'Setup could not start: ' : 'The last setup attempt failed: '}{failure.replace(/\.$/, '')}.</p>}
    {!setup.readOnly && <div><Btn variant="primary" loading={busy} disabled={!!setup.blocked} onClick={() => void start()}>{failure ? 'Try setup again' : 'Set up database'}</Btn></div>}
  </section>;
}
