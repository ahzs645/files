import type { ButtonHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { buttonClassName } from '@zoer/plugin-ui/button';

/** Preserve source button semantics using the host's shared control styling. */
export function Button({ variant = 'primary', loading = false, disabled, className = '', children, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'success' | 'danger' | 'ghost';
  loading?: boolean;
}) {
  const hostVariant = variant === 'ghost' ? 'secondary' : variant === 'success' ? 'primary' : variant;
  return <button {...props} type={type} disabled={disabled || loading} aria-busy={loading || undefined} data-variant={hostVariant}
    className={buttonClassName(hostVariant, 'md', `bid-native-button ${className}`)}>
    {loading && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}{children}
  </button>;
}
