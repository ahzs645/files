import { expect, it } from 'vitest';
import { readWorkspaceMetadata } from '../zoer/dashboard/workspace-bootstrap';

it('starts bounded metadata pages together rather than blocking tables behind serial history requests', async () => {
  const releases: (() => void)[] = [], calls: string[][] = [];
  const pending = readWorkspaceMetadata(async (_method, input: any) => {
    calls.push(input.keys);
    await new Promise<void>(resolve => releases.push(resolve));
    return {entries: input.keys.map((key: string) => ({key,value:key}))};
  }, Array.from({length:104},(_,i)=>'run:'+i));
  expect(calls).toHaveLength(6);expect(calls.every(keys=>keys.length<=20)).toBe(true);
  releases.forEach(release=>release());
  const entries=await pending;
  expect(entries).toHaveLength(104);expect(entries.at(-1)?.key).toBe('run:103');
});

it('reports a failed metadata page instead of silently publishing incomplete history',async()=>{
  await expect(readWorkspaceMetadata(async()=>{throw Error('Catalog offline');},['run:1'])).rejects.toThrow('Catalog offline');
});
