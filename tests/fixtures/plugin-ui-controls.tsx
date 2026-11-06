import type { ReactNode } from 'react';

// The host supplies @zoer/plugin-ui at load time. Tests use this stand-in, so host-ui takes its fallbacks for anything newer.
export function Btn({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) {
  return <button type="button" aria-label={props['aria-label'] as string | undefined}>{children}</button>;
}
