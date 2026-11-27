import { Building2 } from 'lucide-react';
import { Btn } from '@zoer/plugin-ui/controls';
import { EmptyState } from '../host-ui';
import { navigatePlugin } from '../navigation';
import { useCapabilities } from '../capabilities';
import { useProfileState, type ProfileState } from './profile-context';
import { ProfilePicker } from './ProfilePicker';
import './review.css';

/** Title and sentence for each profile state; pure so every page words it the same and tests can read it. */
export function profilePromptText(state: ProfileState, draftName: string | undefined, writes: boolean): { title: string; description: string } | null {
  if (state === 'chosen') return null;
  if (state === 'draft-only') return writes
    ? { title: `Publish your profile “${draftName || 'Untitled'}”`, description: 'Drafts are not used for assessments. Publish it in Setup › Profiles to assess fit, readiness and requirement gaps.' }
    : { title: 'No published company profile', description: `The profile “${draftName || 'Untitled'}” is not published in this copy, so fit and readiness are not assessed.` };
  if (state === 'none') return writes
    ? { title: 'Create a company profile', description: 'Fit, readiness and requirement gaps are assessed against your company profile.' }
    : { title: 'No company profile', description: 'This copy has no company profile, so fit and readiness are not assessed.' };
  return { title: 'Choose a profile', description: 'Fit, readiness and requirement gaps are assessed against the profile you choose in “Assess as”.' };
}

/**
 * The one company-profile prompt (create / publish / choose), worded for the reader's actual state. Render it once
 * per page in place of every profile-dependent panel; it renders nothing once a profile is chosen or while loading.
 * `picker` adds an inline "Assess as" menu for the choose state (leave it off when the page header already has one).
 */
export function ProfilePrompt({ picker = true }: { picker?: boolean }) {
  const { state, draftName, loading } = useProfileState(), { writes } = useCapabilities();
  const text = loading ? null : profilePromptText(state, draftName, writes);
  if (!text) return null;
  const action = state === 'unchosen' ? (picker ? <div className="rw-choose-profile"><ProfilePicker label={false} /></div> : undefined)
    : writes ? <Btn size="sm" variant="primary" onClick={() => navigatePlugin('/profiles')}>{state === 'draft-only' ? 'Open Profiles' : 'New profile'}</Btn> : undefined;
  return <div className="rw-profile-prompt" data-state={state}><EmptyState icon={<Building2 aria-hidden="true" />} title={text.title} description={text.description} action={action} /></div>;
}
