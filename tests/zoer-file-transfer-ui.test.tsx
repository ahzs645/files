// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BatchProgress } from '../zoer/dashboard/BatchProgress';

it('shows the active file size and sends only that transfer when Skip is clicked', () => {
  const batches=[{id:'batch',kind:'download',status:'running',completed:1,total:2}];
  const task={id:'task',run_id:'batch',name:'Meeting.mp4',phase:'Downloading',status:'running',transferId:'attempt',expectedBytes:2097152};
  const skip=vi.fn(async()=>{});
  const view=render(<BatchProgress batches={batches} tasks={[task]} onSkip={skip} />);
  expect(screen.getByRole('status').textContent).toContain('Meeting.mp4 · 2.0 MiB');
  fireEvent.click(screen.getByRole('button',{name:'Skip file'}));
  expect(skip).toHaveBeenCalledWith('task','attempt');
  expect(screen.getByRole('button',{name:'Skipping…'})).toBeDisabled();
  view.rerender(<BatchProgress batches={batches} tasks={[{...task,transferId:'next',expectedBytes:undefined}]} onSkip={skip} />);
  expect(screen.getByRole('status').textContent).toContain('Size unknown');
  expect(screen.getByRole('button',{name:'Skip file'})).toBeEnabled();
  view.rerender(<BatchProgress batches={batches} tasks={[task]} showSize={false} />);
  expect(screen.getByRole('status').textContent).not.toContain('MiB');
  expect(screen.queryByRole('button')).toBeNull();
});
