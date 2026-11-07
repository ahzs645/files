import { execFileSync } from 'node:child_process';
import { zoerRoot } from './dashboard-config';

/** Shared UI provenance can be read without retaining a completed Vite build in memory. */
export const sharedUiSource = {
  repository: 'https://github.com/ahzs645/zoer.git',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: zoerRoot, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: zoerRoot, encoding: 'utf8' }).trim()),
  entrypoint: 'frontend/src/plugin-ui/database.ts',
};
