// Pressing a record in the phone list or the table opens this sheet (a side dialog on desktop) with the key facts.
// Opportunities can then be opened fully on their detail page; awards link to their BC Bid source page.
// The host stretches the iframe over the whole window while it is open; main.tsx pads the layout by the panel offsets so nothing shifts.
import { useNavigate } from '@tanstack/react-router';
import { Modal, Btn } from '@zoer/plugin-ui/controls';
import { StarButton } from '../../apps/dashboard/src/components/preferences/BidPreferences';
import { BuyerName } from '../../apps/dashboard/src/components/ui/BuyerName';
import { getOpportunityStatusTone, OPPORTUNITY_TONE_STYLES } from '../../apps/dashboard/src/lib/constants';
import { awardSummary, opportunitySummary, type BidRow } from './bid-summaries';

export function RecordSheet({ kind, row, onClose }: { kind: 'opportunity' | 'award'; row: BidRow; onClose: () => void }) {
  const navigate = useNavigate();
  if (kind === 'opportunity') {
    const item = opportunitySummary(row);
    const tone = getOpportunityStatusTone(item.status);
    const openFully = () => { onClose(); void navigate({ to: '/opportunities/$processId', params: { processId: item.processId } }); };
    return <Modal title={item.title} onClose={onClose} footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn><Btn variant="primary" onClick={openFully}>Open fully</Btn></>}>
      <div className="bid-sheet">
        <div className="bid-list-meta"><span className={`bid-list-status ${OPPORTUNITY_TONE_STYLES[tone]}`}>{item.status}</span>{item.id && <span>{item.id}</span>}{item.type && <span>{item.type}</span>}<StarButton entity="opportunity" recordKey={item.key} label={item.title} /></div>
        <dl className="bid-list-fields">
          <div><dt>Buyer</dt><dd><BuyerName record={row} /></dd></div>
          <div><dt>Closes</dt><dd>{item.closingDate}</dd></div>
          {item.detailUrl && <div><dt>Source</dt><dd><a href={item.detailUrl} target="_blank" rel="noreferrer">View on BC Bid</a></dd></div>}
        </dl>
      </div>
    </Modal>;
  }
  const item = awardSummary(row);
  const fields: [string, string][] = [['Awarded', item.awardDate], ['Type', item.type], ['Supplier', item.supplier], ['Value', item.valueText], ['Original value', item.originalValueText], ['Contract number', item.contractNumber], ['Location', item.location], ['Opportunity ID', item.id], ['Justification', item.justification]];
  return <Modal title={item.title} onClose={onClose} footer={<><Btn variant="ghost" onClick={onClose}>Close</Btn>{item.sourceUrl && <Btn variant="primary" onClick={() => window.open(item.sourceUrl, '_blank', 'noopener,noreferrer')}>Open on BC Bid</Btn>}</>}>
    <div className="bid-sheet">
      <div className="bid-list-meta"><StarButton entity="award" recordKey={item.key} label={item.title} /></div>
      <dl className="bid-list-fields">
        <div><dt>Buyer</dt><dd><BuyerName record={row} /></dd></div>
        {fields.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </div>
  </Modal>;
}
