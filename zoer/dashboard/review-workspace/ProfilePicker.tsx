import { Select } from '@zoer/plugin-ui/controls';
import { navigatePlugin, pluginHref } from '../navigation';
import { useCapabilities } from '../capabilities';
import { useActiveProfile, useProfileSummaries, type ProfileSummary } from './profile-context';
import { profileSelectable } from './profile-types';
import type { ProfileVersionRow } from './queries';
import './review.css';

const MANAGE = '__create';

export type PickerOption = { value: string; text: string; disabled?: boolean };
/**
 * The "Assess as" menu: no profile, every published version, then every unpublished profile as a disabled
 * "(draft, not published)" entry so a draft is never hidden behind "Create a profile…". The trailing option says
 * "Manage profiles…" whenever any profile exists, draft or published. Pure, for tests.
 */
export function profilePickerOptions(versions: readonly Pick<ProfileVersionRow, 'id' | 'name' | 'version'>[], profiles: readonly ProfileSummary[], writes: boolean): PickerOption[] {
  const drafts = profiles.filter(profile => !profile.published);
  return [
    { value: '', text: 'No company profile' },
    ...versions.map(version => ({ value: version.id, text: `${version.name} · v${version.version}` })),
    ...drafts.map(profile => ({ value: `draft:${profile.id}`, text: `${profile.name} (draft, not published)`, disabled: true })),
    ...(writes ? [{ value: MANAGE, text: versions.length || profiles.length ? 'Manage profiles…' : 'Create a profile…' }] : []),
  ];
}

/**
 * "Assess as" company profile version, the one picker every page uses. "No company profile" keeps triage and
 * extraction useful but leaves eligibility not assessed. Drafts are listed but cannot be chosen; a "Publish" link next
 * to the menu opens the draft in Setup › Profiles.
 */
export function ProfilePicker({ label = true }: { label?: boolean }) {
  const { profileVersionId, active, versions, loading, setProfileVersionId } = useActiveProfile(), { writes } = useCapabilities();
  const { profiles } = useProfileSummaries();
  // A read-only copy with at most one profile has nothing to choose: name the profile in use as quiet text.
  if (!loading && !profileSelectable(writes, versions.length)) return <span className="rw-profile-picker rw-profile-quiet">{label && <span>Assess as</span>}<b>{active ? `${active.name} · v${active.version}` : 'No company profile'}</b></span>;
  const draft = writes && !versions.length ? profiles.find(profile => !profile.published) : undefined;
  const publishHref = draft ? `/profiles?profile=${encodeURIComponent(draft.id)}` : '';
  return <label className="rw-profile-picker">
    {label && <span>Assess as</span>}
    <Select aria-label="Assess as company profile" presentation="dropdown" searchable={false} disabled={loading} value={profileVersionId ?? ''}
      onChange={event => event.target.value === MANAGE ? navigatePlugin('/profiles') : event.target.value.startsWith('draft:') ? undefined : setProfileVersionId(event.target.value || null)}>
      {profilePickerOptions(versions, profiles, writes).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.text}</option>)}
    </Select>
    {draft && <a className="rw-profile-publish" href={pluginHref(publishHref)} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); navigatePlugin(publishHref); } }}>Publish</a>}
  </label>;
}
