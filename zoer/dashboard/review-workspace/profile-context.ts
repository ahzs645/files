import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { readProfileVersions } from './queries';
import { useCapabilities } from '../capabilities';
import { readOnlyDefaultProfile } from './profile-types';
import { profileStateOf, readProfileSummaries, type ProfileState } from './profile-summaries';
export { profileStateOf, readProfileSummaries, type ProfileState, type ProfileSummary } from './profile-summaries';

// The active company profile version is a reader preference, not shared data, so it lives in localStorage.
// Switching it changes which assessments are shown; it never relabels an assessment made for another version.
const KEY = 'procurement-review-profile-version';
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) || null; } catch { return null; } };

export function setActiveProfileVersion(id: string | null) {
  try { id ? localStorage.setItem(KEY, id) : localStorage.removeItem(KEY); } catch { /* Private mode: stays for this page only. */ }
  listeners.forEach(listener => listener());
}

export function useActiveProfile() {
  const workspace = useReviewWorkspace();
  const stored = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, read, () => null);
  const versions = useQuery({ queryKey: [...REVIEW_KEY, 'profile-versions'], queryFn: readProfileVersions, enabled: !!workspace.data?.available });
  const list = versions.data ?? [];
  // A stale stored id (deleted catalog, restored backup) reads as "no profile", not as another version. A read-only
  // copy with a single profile has nothing to choose (ProfilePicker shows it as text), so it assesses as that one.
  const { writes } = useCapabilities();
  const active = list.find(version => version.id === stored) ?? readOnlyDefaultProfile(writes, list);
  return { profileVersionId: active?.id ?? null, active, versions: list, loading: workspace.isPending || versions.isPending, setProfileVersionId: setActiveProfileVersion };
}

/** Every profile, drafts included; published versions come from `useActiveProfile`. */
export function useProfileSummaries() {
  const workspace = useReviewWorkspace(), { versions, loading } = useActiveProfile();
  const profiles = useQuery({ queryKey: [...REVIEW_KEY, 'profile-summaries', versions.map(version => version.id).join(',')], queryFn: () => readProfileSummaries(versions), enabled: !!workspace.data?.available && !loading });
  return { profiles: profiles.data ?? [], loading: loading || profiles.isPending };
}

/**
 * The profile state for prompts and pickers: `{ state, draftName }` (see `profileStateOf`). `loading` is true until
 * both reads finish; callers should show nothing profile-related meanwhile rather than a wrong prompt.
 */
export function useProfileState(): { state: ProfileState; draftName?: string; loading: boolean } {
  const { profileVersionId } = useActiveProfile(), { profiles, loading } = useProfileSummaries();
  return { ...profileStateOf(profiles, profileVersionId), loading };
}
