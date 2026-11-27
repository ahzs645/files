import { sql } from '../procurement/display';
import type { ProfileVersionRow } from './queries';

/**
 * Where the reader stands with company profiles, for the one profile prompt every page shows (ProfilePrompt):
 * `none` (no profile at all), `draft-only` (profiles exist but none is published, so nothing can be assessed),
 * `unchosen` (a published version exists but "Assess as" is empty) or `chosen`. `draftName` names the first
 * unpublished profile when that is the state.
 */
export type ProfileState = 'none' | 'draft-only' | 'unchosen' | 'chosen';
export interface ProfileSummary { id: string; name: string; published: boolean }

export function profileStateOf(profiles: readonly ProfileSummary[], chosenId: string | null): { state: ProfileState; draftName?: string } {
  if (chosenId) return { state: 'chosen' };
  if (profiles.some(profile => profile.published)) return { state: 'unchosen' };
  const draft = profiles.find(profile => !profile.published);
  return draft ? { state: 'draft-only', draftName: draft.name } : { state: 'none' };
}

/** Every company profile with whether any version of it is published (drafts included, unlike readProfileVersions). */
export async function readProfileSummaries(versions: readonly ProfileVersionRow[] = []): Promise<ProfileSummary[]> {
  const rows = await sql('SELECT id, name FROM procurement_profiles ORDER BY lower(name), id LIMIT 200');
  const published = new Set(versions.map(version => version.profileId));
  return rows.map(row => ({ id: String(row.id), name: String(row.name ?? ''), published: published.has(row.id) }));
}

