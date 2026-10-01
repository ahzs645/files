import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { REVIEW_KEY, useReviewWorkspace } from './actions';
import { readProfileVersions } from './queries';

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
  // A stale stored id (deleted catalog, restored backup) reads as "no profile", not as another version.
  const active = list.find(version => version.id === stored) ?? null;
  return { profileVersionId: active?.id ?? null, active, versions: list, loading: workspace.isPending || versions.isPending, setProfileVersionId: setActiveProfileVersion };
}
