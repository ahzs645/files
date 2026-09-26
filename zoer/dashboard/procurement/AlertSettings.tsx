import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Btn} from '@zoer/plugin-ui/controls';
import {host} from '../bridge';
import {runProcurementAction} from './state-client';
export function AlertSettings(){
 const [hours,setHours]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const query=useQuery({queryKey:['catalog','procurement-alert-schedule'],queryFn:()=>host('schedules.read'),refetchInterval:10000});
 const schedule=query.data?.schedules.find((s:any)=>s.actionId==='procurement.alerts');
 const run=async(fn:()=>Promise<unknown>,success:string)=>{setBusy(true);setError('');setMessage('');try{await fn();await query.refetch();setMessage(success);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const interval=hours??String(schedule?.intervalHours??24),valid=interval.trim()!==''&&Number.isInteger(Number(interval))&&Number(interval)>=1&&Number(interval)<=720;
 const save=(enabled:boolean)=>run(()=>host('schedules.save',{actionId:'procurement.alerts',enabled,intervalHours:enabled?Number(interval):Number(schedule?.intervalHours??24)}),enabled?'Alert schedule saved.':'Alert schedule paused.');
 return <section className="procurement-workflow" aria-label="Saved-search alerts"><header><h2>Alerts</h2><p>Get a Zoer notification when a saved search has new or changed results.</p></header><label>Check every (hours)<input aria-label="Alert interval hours" type="number" min={1} max={720} step={1} value={interval} onChange={e=>setHours(e.target.value)} /></label><p role="status">{schedule?.enabled?`Enabled · next check ${new Date(schedule.nextRunAt).toLocaleString()}`:'Paused / not scheduled'}{schedule?.lastStatus?` · last run ${schedule.lastStatus}`:''}</p>{schedule?.error&&<p role="alert">{schedule.error}</p>}<div className="procurement-actions"><Btn disabled={busy||query.isPending||!!query.error||!valid} onClick={()=>void save(true)}>{schedule?.enabled?'Save interval':'Enable alerts'}</Btn><Btn variant="secondary" disabled={busy||!schedule?.enabled} onClick={()=>void save(false)}>Pause alerts</Btn><Btn variant="secondary" disabled={busy} onClick={()=>void run(()=>runProcurementAction('procurement.alerts',{}),'Saved-search check finished. Delivery receipts are retained in the catalog.')}>Check alerts now</Btn></div>{(error||query.error)&&<p role="alert">{error||query.error?.message}</p>}{message&&<p role="status">{message}</p>}</section>;
}
