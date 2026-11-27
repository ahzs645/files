import { ProfilePrompt } from './ProfilePrompt';

/** Kept for existing callers: the state-aware profile prompt (ProfilePrompt) with an inline picker when `picker` is set. */
export function ChooseProfile({ picker = false }: { picker?: boolean }) {
  return <ProfilePrompt picker={picker} />;
}
