import type { ReactNode, SelectHTMLAttributes } from 'react';

// The host supplies @zoer/plugin-ui/database at build time. Tests use a native select with the same props.
export function Select({ children, presentation: _presentation, searchable: _searchable, optionDetails: _details, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children?: ReactNode; presentation?: string; searchable?: boolean; optionDetails?: unknown }) {
  return <select {...props}>{children}</select>;
}
