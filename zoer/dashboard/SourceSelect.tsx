import type { ComponentType } from 'react';
import { Select as HostSelect } from '@zoer/plugin-ui/database';

/** Source dashboard select contract backed by Zoer's searchable mobile picker. */
export function Select({ label, value, onChange, options, icon: Icon }: {
  label?: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[];
  icon?: ComponentType<{ size?: number; className?: string }>;
}) {
  return <div className="flex min-w-0 items-center gap-2">
    {Icon && <Icon size={14} className="shrink-0 text-text-secondary" />}
    <HostSelect aria-label={label || 'Choose an option'} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </HostSelect>
  </div>;
}
