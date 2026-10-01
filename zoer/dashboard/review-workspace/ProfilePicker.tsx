import { Select } from '@zoer/plugin-ui/controls';
import { navigatePlugin } from '../navigation';
import { useActiveProfile } from './profile-context';
import './review.css';

const CREATE = '__create';

/**
 * "Assess as" company profile version. "No company profile" keeps triage and extraction useful but leaves
 * eligibility not assessed. Creating a profile is an option in the same menu, so the control stays one line.
 */
export function ProfilePicker({ label = true }: { label?: boolean }) {
  const { profileVersionId, versions, loading, setProfileVersionId } = useActiveProfile();
  return <label className="rw-profile-picker">
    {label && <span>Assess as</span>}
    <Select aria-label="Assess as company profile" presentation="dropdown" searchable={false} disabled={loading} value={profileVersionId ?? ''}
      onChange={event => event.target.value === CREATE ? navigatePlugin('/profiles') : setProfileVersionId(event.target.value || null)}>
      <option value="">No company profile</option>
      {versions.map(version => <option key={version.id} value={version.id}>{version.name} · v{version.version}</option>)}
      <option value={CREATE}>{versions.length ? 'Manage profiles…' : 'Create a profile…'}</option>
    </Select>
  </label>;
}
