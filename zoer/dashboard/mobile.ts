import { useEffect, useState } from 'react';

/** True below the host's mobile breakpoint (max-width: 767px), updating on resize and orientation changes. */
export function useNarrowScreen(query = '(max-width: 767px)') {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}
