import { useQuery as useCachedQuery } from '@tanstack/react-query';
import { queryClient } from './query-client';
import { BidPreferences } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { compactCheckpoint } from '../src/checkpoint';
import { useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import { buildContractAwardImportKey } from '../../packages/shared/src/contractAwards';
import { buildModel, queryModel, type Model, type SavedDocument, type WorkspaceState } from './model';
import { host } from './bridge';
import { queryCatalog, readAll, resetCatalogCache } from './queries';
export { readAll } from './queries';
let snapshot: { model?: Model; error?: string; notice?: string } = {};
const listeners = new Set<() => void>();
let databaseRevision = -1;
export function analysisRevision() { return databaseRevision; }

let savedEntries: any[] = [];
let fullCheckpoint: any = null;
const loadedHistory = new Set<string>();
let migrationStarted = false;
let pending: Promise<void> | undefined;
let generation = 0;
let rawState: WorkspaceState = { runs: [], artifacts: [] };
const emit = () => { for (const listener of listeners) listener(); };
export function refresh() {
  if (pending) return pending;
  const current = generation;
  pending = (async () => {
    try {
      const state = await host('state', { summary: true }) as WorkspaceState;
      rawState = state;
      const head = await host('catalog.read', { ids: [] });
      if (!head.primary) {
        if (import.meta.env.VITE_ZOER_NATIVE) throw new Error('The existing BC Bid catalog is not ready. Open its database in Databases before continuing.');
        const active = state.runs.find(run => !['succeeded','failed','cancelled','outcome_unknown'].includes(run.status));
        if (active?.actionId === 'catalog.migrate') { snapshot = { notice: 'Moving saved bids into the database… You can leave this page open.' }; return; }
        if (active) throw new Error('Wait for the active BC Bid run to finish before migrating its database.');
        if (!migrationStarted) { migrationStarted=true; await host('action', {actionId:'catalog.migrate',input:{}}); }
        else throw new Error('Database migration did not finish. Reload to retry; existing files are retained.');
        snapshot = { notice: 'Moving saved bids into the database… Existing data is retained.' }; return;
      }
      if (head.revision !== databaseRevision) {
        const entries: any[] = [];
        const keys = ['checkpoint:awards', 'checkpoint:awards:recent', 'checkpoint:full', ...state.runs.map(run => 'run:' + run.id)];
        for (let i = 0; i < keys.length; i += 20) {
          const page = await host('catalog.workspace', { keys: keys.slice(i, i + 20) });
          entries.push(...page.entries);
        }
        savedEntries=entries;databaseRevision=head.revision;
      }
      const metadata=savedEntries.filter(entry=>entry.key.startsWith('run:')).map(entry=>entry.value).map(item=>item.document.kind==='listing'?{...item,document:{...item.document,kind:'scrape'}}:item);
      if (current !== generation) return;
      const model=buildModel(state,metadata);
      model.stars=new Map(snapshot.model?.stars);
      model.awardCheckpoint=savedEntries.find(entry=>entry.key==='checkpoint:awards')?.value??null;
      model.awardRecentCheckpoint=savedEntries.find(entry=>entry.key==='checkpoint:awards:recent')?.value??null;
      fullCheckpoint=savedEntries.find(entry=>entry.key==='checkpoint:full')?.value??null;
      if(snapshot.model && databaseRevision===head.revision) for(const id of loadedHistory) model.history.set(id,snapshot.model.history.get(id)??new Map());
      snapshot = { model };
    } catch (error) { if (current !== generation) return; snapshot = { ...snapshot, error: error instanceof Error ? error.message : 'Unable to read Zoer data.' }; }
    finally { if (current === generation) { pending = undefined; emit(); } }
  })();
  return pending;
}

export function startWorkspace() {
  void refresh();
  let lastPoll = Date.now();
  const timer = setInterval(() => {
    if (document.hidden) return;
    const active = rawState?.runs.some(run => !['succeeded','failed','cancelled','outcome_unknown'].includes(run.status)) ?? false;
    if (Date.now() - lastPoll < (active ? 10000 : 30000)) return;
    lastPoll = Date.now(); void refresh();
  }, 2500);
  const visible = () => { if (!document.hidden) { lastPoll = Date.now(); void refresh(); } };
  document.addEventListener('visibilitychange', visible);
  return () => {
    clearInterval(timer); document.removeEventListener('visibilitychange', visible);
    generation++; pending = undefined; snapshot = {}; databaseRevision = -1;
    savedEntries = []; fullCheckpoint = null; loadedHistory.clear(); migrationStarted = false;
    rawState = { runs: [], artifacts: [] }; queryClient.clear(); resetCatalogCache(); starPending.clear(); emit();
  };
}
if (!import.meta.env.VITE_ZOER_NATIVE) startWorkspace();

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let visibleRevision = 0;
export function catalogRevision() { return visibleRevision; }
function invalidateCatalog() {
  visibleRevision++;
  void queryClient.invalidateQueries({ queryKey: ['catalog'] });
}
export async function queryVisibleCatalog(args:any) {
  if(!snapshot.model) await refresh();
  if(!snapshot.model) throw new Error(snapshot.error || 'Catalog is loading.');
  const result=await queryCatalog('catalog.rows',args,snapshot.model,databaseRevision);
  if(snapshot.model) for(const row of result.items) snapshot.model.stars.set(row.catalogId,row.starred===true);
  snapshot={...snapshot};emit();
  return result;
}
export function useWorkspace() { return useSyncExternalStore(subscribe, () => snapshot); }
export function useQuery(name: string, args: any) {
  const { model } = useWorkspace();
  const { onlyStarred } = useContext(BidPreferences);
  const runId=name==='opportunities.listByRunId'&&args!=='skip'?args?.runId:undefined;
  useEffect(()=>{
    if(!runId || loadedHistory.has(runId))return;
    let alive=true;
    void (async()=>{const rows:any[]=[];let after:string|null='';do{const page=await host('catalog.history',{runId,after});rows.push(...page.rows);after=page.next;}while(after);
      if(alive&&snapshot.model){loadedHistory.add(runId);const history=new Map(snapshot.model.history);history.set(runId,new Map(rows.map(row=>[row.id,row.data])));snapshot={...snapshot,model:{...snapshot.model,history}};emit();}
    })().catch(error=>{if(alive){snapshot={...snapshot,error:error.message};emit();}});
    return()=>{alive=false;};
  },[runId]);
  const queryArgs = { ...args, starredOnly: args?.starredOnly ?? onlyStarred };
  const remote = name === 'dashboard.summary' || name.startsWith('catalog.') || name.startsWith('contractAwardsAnalysis.') || ['opportunities.list','opportunities.getByProcessId','contractAwards.list','contractAwards.summary'].includes(name);
  const query = useCachedQuery({
    queryKey: ['catalog', name, queryArgs],
    enabled: !!model && args !== 'skip' && remote,
    queryFn: async () => {
      const value = await queryCatalog(name, queryArgs, snapshot.model!, databaseRevision);
      const rows = value?.items ?? (name === 'opportunities.getByProcessId' && value ? [value] : []);
      if (snapshot.model) for (const row of rows) snapshot.model.stars.set(row.catalogId ?? 'opportunity:' + row.sourceKey, row.starred === true);
      return value;
    },
    // Analysis/export reads are explicit snapshots, not part of progress polling.
    refetchInterval: name.startsWith('contractAwardsAnalysis.') ? false : 30_000,
  });
  if (!model || args === 'skip') return undefined;
  if (!remote) return queryModel(model, name, queryArgs);
  const value = query.data;
  return name === 'dashboard.summary' && value ? { ...value, latestRun: model.runs[0] ?? null, latestSuccessfulRun: model.runs.find(run => run.status === 'succeeded') ?? null } : value;

}
async function invoke(name: string, args: any) {
  const epoch = generation;
  const assertCurrent = () => { if (epoch !== generation) throw new Error('Workspace closed.'); };
  await refresh(); assertCurrent();
  if (snapshot.error) throw new Error(snapshot.error);
  const model = snapshot.model!;
  if (name === 'scrapes.triggerNow') {
    const active = queryModel(model, 'scrapeRuns.active');
    if (active) return { runId: active._id, alreadyRunning: true };
    const { run } = await host('action', { actionId: 'scrape.full', input: {} });
    await refresh(); return { runId: run.id, alreadyRunning: false };
  }
  if (name === 'scrapes.stopActive') {
    const active = queryModel(model, 'scrapeRuns.active');
    if (!active) return { accepted: false };
    await host('cancel', { id: active._id }); await refresh(); return { accepted: true, runId: active._id };
  }
  if (name === 'contractAwards.importBatch' || name === 'opportunities.importBatch') {
    const opportunity=name==='opportunities.importBatch';
    const unique = new Set(args.records.map((row:any)=>opportunity?(row.sourceKey??row.processId):buildContractAwardImportKey(row)));
    const existing = await host('catalog.read', { ids: [...unique].map(key => (opportunity ? 'opportunity:' : 'award:') + key) });
    const updated = existing.records.length;
    const { run } = await host('action', { actionId: opportunity?'opportunities.import':'awards.import', input: args });
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1200)); assertCurrent(); await refresh(); assertCurrent();
      const current = rawState.runs.find(item => item.id === run.id);
      if (current?.status === 'succeeded') { invalidateCatalog(); return { inserted: unique.size - updated, updated, deduped: args.records.length - unique.size }; }
      if (current && ['failed', 'cancelled', 'outcome_unknown'].includes(current.status)) throw new Error(current.error || 'Award import did not complete.');
    }
    throw new Error('Import is still running in Zoer. Check run history before retrying.');
  }
  if (name.startsWith('contractAwardsImport.') && name !== 'contractAwardsImport.status') throw new Error('Use JSON file upload in Zoer. The standalone scraper folder is not mounted.');
  const value = await queryCatalog(name, args, model, databaseRevision);
  if (snapshot.model) { for (const [key, starred] of model.stars) snapshot.model.stars.set(key, starred); snapshot = { ...snapshot }; emit(); }
  return value;
}
export function useAction(name: string) { return useCallback((args: any) => invoke(name, args), [name]); }
export const useMutation = useAction;

export function resumableCheckpoint() {
  if (!fullCheckpoint || fullCheckpoint.complete || !snapshot.model || queryModel(snapshot.model,'scrapeRuns.active')) return null;
  return structuredClone(fullCheckpoint);
}
export async function resumeFullScrape() {
  await refresh();
  const resume = resumableCheckpoint();
  if (!resume) throw new Error('No incomplete scrape to resume.');
  await host('action', { actionId: 'scrape.full', input: { resume: compactCheckpoint(resume) } });
  await refresh();
}

export async function testScraperBrowser() {
  await refresh();
  if (snapshot.error) throw new Error(snapshot.error);
  if (snapshot.model && queryModel(snapshot.model, 'scrapeRuns.active')) throw new Error('Wait for the active scrape to finish before testing the browser.');
  const { run } = await host('action', { actionId: 'scrape.sample', input: { detailLimit: 1 } });
  await refresh();
  return run.id as string;
}

const starPending = new Map<string, Promise<void>>();
export function isStarPending(entity: 'opportunity' | 'award', key: string) { return starPending.has(entity + ':' + key); }
export function setStar(entity: 'opportunity' | 'award', key: string, starred: boolean) {
  const epoch = generation;
  const assertCurrent = () => { if (epoch !== generation) throw new Error('Workspace closed.'); };
  const id = entity + ':' + key;
  if (starPending.has(id)) return starPending.get(id)!;
  const promise = (async () => {
    const { run } = await host('action', { actionId: 'stars.set', input: { entity, key, starred } });
    const deadline = Date.now() + 150000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000)); assertCurrent(); await refresh(); assertCurrent();
      const current = rawState.runs.find(item => item.id === run.id);
      if (current?.status === 'succeeded') { invalidateCatalog(); if (snapshot.error) throw new Error(snapshot.error); return; }
      if (current && ['failed', 'cancelled', 'outcome_unknown'].includes(current.status)) throw new Error(current.error || 'Could not save star.');
    }
    throw new Error('Star is still saving. Check again before retrying.');
  })().finally(() => { if (epoch === generation) { starPending.delete(id); snapshot = { ...snapshot }; emit(); } });
  starPending.set(id, promise); snapshot = { ...snapshot }; emit(); return promise;
}
export function activeAwardRun(model: Model) { return model.awardRuns.find(run => !['succeeded','failed','cancelled','outcome_unknown'].includes(run.status)); }
export async function startAwardHistory(resume = false, recent = false) {
  await refresh(); if (snapshot.error) throw new Error(snapshot.error);
  if (activeAwardRun(snapshot.model!)) return;
  const checkpoint = snapshot.model!.awardCheckpoint;
  if (resume && (!checkpoint || checkpoint.complete)) throw new Error('No incomplete history to resume.');
  await host('action', { actionId: 'awards.history', input: recent ? { mode: 'recent' } : resume && checkpoint?.version === 2 ? { resume: checkpoint } : {} }); await refresh();
}
export async function stopAwardHistory() {
  const active = snapshot.model && activeAwardRun(snapshot.model);
  if (active) { await host('cancel', { id: active.id }); await refresh(); }
}
