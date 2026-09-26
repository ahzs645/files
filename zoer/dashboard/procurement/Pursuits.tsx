import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkspace } from '../backend';
import { buildProcurementQuery } from './catalog';
import { PursuitBoard } from './PursuitBoard';
import { NoticeDetail } from './NoticeDetail';
import { EvidencePanel } from './EvidencePanel';
import { sql } from './display';

/** Pursuit stages for notices you are working on. Shortlisted notices are offered for adding. */
export function Pursuits() {
  const { model } = useWorkspace();
  const shortlist = buildProcurementQuery({ starred: true, limit: 50 });
  const candidates = useQuery({ queryKey: ['catalog', 'procurement-shortlist'], enabled: !!model, queryFn: () => sql(shortlist.statement, shortlist.parameters) });
  const [detailId, setDetailId] = useState(''), [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  return <section className="procurement-workspace" aria-label="Pursuits">
    <PursuitBoard records={candidates.data ?? []} onOpenRecord={setDetailId} />
    {detailId && <NoticeDetail id={detailId} onClose={() => setDetailId('')} onEvidence={setEvidenceIds} />}
    {evidenceIds.length > 0 && <EvidencePanel recordIds={evidenceIds} onClose={() => setEvidenceIds([])} />}
  </section>;
}
