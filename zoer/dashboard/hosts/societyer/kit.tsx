import { forwardRef, useEffect, useId, useLayoutEffect, useRef, type ComponentProps, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, Loader2, X } from 'lucide-react';
import type HostBtn from '@zoer/plugin-ui-host/button';
import type { buttonClassName as hostButtonClassName } from '@zoer/plugin-ui-host/button';
import type { EmptyState as HostEmptyState, Modal as HostModal, SelectProps, StatusBadge as HostStatusBadge } from '@zoer/plugin-ui-host/controls';
import { portalRoot } from './portal';

/**
 * Societyer renderings of the most visible `@zoer/plugin-ui` controls. Props are Zoer's own (taken from the real
 * components' types), the markup is Societyer's (`btn`, `select`, `modal`, `tabs`, `badge`, `empty-state`), so the
 * host's global stylesheet styles them. Everything not replaced here stays Zoer's implementation.
 */
type Variant = NonNullable<Parameters<typeof hostButtonClassName>[0]>;
type Size = NonNullable<Parameters<typeof hostButtonClassName>[1]>;
const VARIANTS: Record<Variant, string> = { primary: 'btn--accent', secondary: '', ghost: 'btn--ghost', danger: 'btn--danger' };
export function buttonClassName(variant: Variant = 'secondary', size: Size = 'md', className = '') {
  return ['btn', VARIANTS[variant], size === 'sm' ? 'btn--sm' : '', className].filter(Boolean).join(' ');
}

type BtnProps = ComponentProps<typeof HostBtn>;
/** Tooltips become the native title: Societyer has no shared tooltip for plain buttons. */
export function Btn({ children, variant = 'secondary', size = 'md', icon, loading, disabled, onClick, className, type = 'button', form, tooltip, 'aria-label': label, 'aria-expanded': expanded, 'aria-describedby': describedBy }: BtnProps) {
  const lead = loading ? <Loader2 className="bcbid-sy-spin" aria-hidden="true" /> : icon;
  return <button type={type} form={form} aria-label={label} aria-expanded={expanded} aria-describedby={describedBy} aria-busy={loading || undefined} title={tooltip} onClick={onClick} disabled={disabled || loading} className={buttonClassName(variant, size, className)}>
    {lead && <span className="btn__icon" aria-hidden="true">{lead}</span>}
    {lead && children != null && children !== false ? <span data-btn-label>{children}</span> : children}
  </button>;
}

/** A styled native select: values, form reset, validation and `onChange` events behave exactly like Zoer's backing select. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, controlSize = 'default', presentation: _presentation, dropdownWidth: _width, searchable: _searchable, optionDetails: _details, variant = 'field', iconOnly: _iconOnly, placeholder: _placeholder, children, ...props }, ref) {
  const classes = ['select', controlSize === 'compact' ? 'select--sm' : '', variant === 'ghost' ? 'select--ghost' : '', className ?? ''].filter(Boolean).join(' ');
  return <select {...props} ref={ref} className={classes}>{children}</select>;
});

type ModalProps = ComponentProps<typeof HostModal>;
/** Societyer's dialog markup inside a native modal `<dialog>`: focus containment, inert page and top-layer stacking. */
export function Modal({ title, onClose, children, footer, headerContent, size = 'default', mobileSheet, 'aria-describedby': describedBy }: ModalProps) {
  const titleId = useId(), dialog = useRef<HTMLDialogElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useLayoutEffect(() => {
    const element = dialog.current, opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal(); heading.current?.focus({ preventScroll: true });
    return () => { element?.close(); opener?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="bcbid-sy-dialog" aria-labelledby={titleId} aria-describedby={describedBy} onCancel={event => { event.preventDefault(); close.current(); }}>
    <div className="modal-backdrop" aria-hidden="true" onClick={() => close.current()} />
    <div className={`modal${mobileSheet ? ' bcbid-sy-sheet' : ''}`} style={{ maxWidth: size === 'wide' ? 'var(--modal-w-xl)' : 'var(--modal-w-lg)' }}>
      {/* A phone sheet fills the screen, so it leads with Back (societyer.css swaps it for the close icon). */}
      <div className="modal__head">{mobileSheet && <button type="button" className="btn btn--ghost btn--sm bcbid-sy-sheet-back" onClick={() => close.current()}><span className="btn__icon" aria-hidden="true"><ChevronLeft /></span><span data-btn-label>Back</span></button>}<h2 ref={heading} tabIndex={-1} id={titleId} className="modal__title">{title}</h2><button type="button" className="btn btn--ghost btn--icon bcbid-sy-sheet-close" aria-label={`Close ${title}`} onClick={() => close.current()}><X aria-hidden="true" /></button></div>
      {headerContent && <div className="bcbid-sy-modal-header">{headerContent}</div>}
      <div className="modal__body">{children}</div>
      {footer && <div className="modal__foot">{footer}</div>}
    </div>
  </dialog>, portalRoot());
}

type TabOption<T extends string> = { id: T; label: string };
/** Zoer's PageTabs contract (roving tab index, arrow/Home/End keys, optional real links) on Societyer's `tabs` strip. */
export function PageTabs<T extends string>({ id, label, tabs, value, onChange, href }: { id: string; label: string; tabs: readonly TabOption<T>[]; value: T; onChange: (value: T) => void; href?: (value: T) => string }) {
  const move = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (href && event.key === ' ') { event.preventDefault(); onChange(tabs[index].id); return; }
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); onChange(tabs[next].id);
    (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus({ preventScroll: true });
  };
  // Societyer's `.tabs` fades whichever edge hides more tabs (`data-overflow` start|end|both); keep the active tab in view.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current; if (!element) return;
    const update = () => { const start = element.scrollLeft > 2, end = element.scrollLeft + element.clientWidth < element.scrollWidth - 2; if (start || end) element.dataset.overflow = start && end ? 'both' : start ? 'start' : 'end'; else delete element.dataset.overflow; };
    update(); element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update); observer.observe(element);
    return () => { element.removeEventListener('scroll', update); observer.disconnect(); };
  }, []);
  useEffect(() => { strip.current?.querySelector<HTMLElement>('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [value]);
  return <div ref={strip} className="tabs bcbid-sy-pagetabs" role="tablist" aria-label={label} aria-orientation="horizontal">
    {tabs.map((tab, index) => {
      const selected = value === tab.id;
      const common: HTMLAttributes<HTMLElement> = { id: `${id}-tab-${tab.id}`, role: 'tab', 'aria-controls': `${id}-panel`, 'aria-selected': selected, tabIndex: selected ? 0 : -1, className: `tab${selected ? ' is-active' : ''}`,
        onClick: (event: MouseEvent<HTMLElement>) => { if (href && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return; event.preventDefault(); onChange(tab.id); },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => move(event, index) };
      const text = <span className="tab__label">{tab.label}</span>;
      return href ? <a key={tab.id} {...common} href={href(tab.id)}>{text}</a> : <button key={tab.id} type="button" {...common}>{text}</button>;
    })}
  </div>;
}

type BadgeProps = ComponentProps<typeof HostStatusBadge>;
type Tone = NonNullable<BadgeProps['tone']>;
const BADGE: Record<Tone, string> = { success: 'badge--success', running: 'badge--info', warning: 'badge--warn', error: 'badge--danger', info: 'badge--info', neutral: '' };
export function StatusBadge({ tone = 'neutral', children, variant = 'pill', icon, className = '' }: BadgeProps) {
  if (variant === 'dot') return <span className={`bcbid-sy-status-dot ${className}`} data-tone={tone}><span aria-hidden="true" /><span>{children}</span></span>;
  return <span className={['badge', BADGE[tone], className].filter(Boolean).join(' ')}>{icon && <span aria-hidden="true" className="bcbid-sy-badge-icon">{icon}</span>}{children}</span>;
}

export function EmptyState({ icon, title, description, action }: ComponentProps<typeof HostEmptyState>) {
  return <div className="empty-state">
    <div className="empty-state__icon" aria-hidden="true">{icon}</div>
    <div className="empty-state__title">{title}</div>
    {description && <div className="empty-state__description">{description}</div>}
    {action && <div className="empty-state__actions">{action}</div>}
  </div>;
}
