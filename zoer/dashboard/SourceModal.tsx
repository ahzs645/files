import type { ReactNode } from 'react';
import { Modal as HostModal, Btn } from '@zoer/plugin-ui/controls';

/** Keep source modal props while sharing Zoer's focus, scrolling and dismissal. */
export function Modal({ open, title, children, onClose }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void;
}) {
  return open ? <HostModal mobileSheet title={title} onClose={onClose} footer={<Btn onClick={onClose}>Done</Btn>}>{children}</HostModal> : null;
}
