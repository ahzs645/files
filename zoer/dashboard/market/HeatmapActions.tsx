import { useId, useRef } from 'react';
import { AnchoredPopover } from '@zoer/plugin-ui/analysis';
import type { Slice } from './model';

export type HeatmapTarget = { anchor: HTMLButtonElement; title: string; slice: Slice };
export type AnalysisAction = (kind: 'buyer' | 'supplier' | 'type', name: string) => void;
/** Shared host popover supplies viewport fitting, keyboard navigation and focus restoration. */
export function HeatmapActions({ target, close, inspect, exclude, focus }: {
  target: HeatmapTarget; close: () => void;
  inspect: (slice: Slice, title: string) => void;
  exclude: AnalysisAction; focus: AnalysisAction;
}) {
  const anchorRef = useRef<HTMLButtonElement>(target.anchor);
  anchorRef.current = target.anchor;
  const id = useId();
  const items = [{ label: 'View matching awards', run: () => inspect(target.slice, target.title) }];
  for (const kind of ['buyer', 'supplier', 'type'] as const) {
    const name = target.slice[kind]; if (!name) continue;
    const label = kind === 'type' ? 'procurement type' : kind;
    items.push({ label: `Focus on this ${label}`, run: () => focus(kind, name) });
    items.push({ label: `Exclude this ${label}`, run: () => exclude(kind, name) });
  }
  return <AnchoredPopover anchorRef={anchorRef} id={id} label="Analysis actions" onClose={close} width={320}>
    <div className="px-3 py-2 text-xs text-text-secondary break-words">{target.title}</div>
    {items.map(item => <button key={item.label} type="button" className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[13px] text-text-primary hover:bg-surface-hover sm:min-h-9" onClick={() => { close(); item.run(); }}>{item.label}</button>)}
    <p className="px-3 py-2 text-xs text-text-secondary">Exclusions filter the analysis. Saved awards stay unchanged.</p>
  </AnchoredPopover>;
}
