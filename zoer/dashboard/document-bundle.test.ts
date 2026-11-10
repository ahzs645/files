import {test, expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBundleDocuments} from './document-bundle';

const source = process.env.ZOER_SOURCE_ROOT ?? new URL('../../../zoer', import.meta.url).pathname;
const {runCatalogSelect, validateCatalogSelect} = await import(pathToFileURL(join(source, 'backend/src/catalog-reader.ts')).href);

test('bundle queries use the real host document view, preserving byte limits and file extensions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'procurement-bundle-'));
  const path = join(root, 'catalog.sqlite');
  const db = new Database(path);
  try {
    db.exec('CREATE TABLE documents(id TEXT,record_id TEXT,url TEXT,name TEXT,media_type TEXT,sha256 TEXT,byte_length INTEGER,text TEXT,status TEXT,error TEXT,updated_at TEXT)');
    const insert = db.query('INSERT INTO documents(id,record_id,name,media_type,byte_length,status) VALUES(?,?,?,?,?,?)');
    insert.run('saved', 'opportunity:235592', 'Terms', 'application/pdf', 411344, 'downloaded');
    insert.run('failed', 'opportunity:235592', 'Missing.pdf', 'application/pdf', 0, 'failed');
    insert.run('other', 'opportunity:other', 'Private.pdf', 'application/pdf', 20, 'downloaded');
    const host = async (method: string, input: any) => {
      expect(method).toBe('catalog.query');
      validateCatalogSelect(input.statement, input.parameters);
      return runCatalogSelect(path, input.statement, input.parameters, true);
    };
    expect(await readBundleDocuments(host, ['opportunity:235592'])).toEqual([
      {id: 'saved', recordId: 'opportunity:235592', name: 'Terms.pdf', bytes: 411344},
    ]);
  } finally {
    db.close();
    await rm(root, {recursive: true, force: true});
  }
});
