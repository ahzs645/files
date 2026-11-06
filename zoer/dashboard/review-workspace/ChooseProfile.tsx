import { Building2 } from 'lucide-react';
import { EmptyState } from '../host-ui';
import { ProfilePicker } from './ProfilePicker';

/** Fit, readiness and gaps are judged against a company profile, so without one they get this single prompt instead of empty charts. */
export function ChooseProfile({ picker = false }: { picker?: boolean }) {
  return <EmptyState icon={<Building2 aria-hidden="true" />} title="Choose a company profile" description={picker ? 'Fit and readiness are assessed against a company profile. Other notices stay available in the list.' : 'Fit, readiness and requirement gaps are assessed against one. Choose it in “Assess as” above.'}
    action={picker ? <div className="rw-choose-profile"><ProfilePicker label={false} /></div> : undefined} />;
}
