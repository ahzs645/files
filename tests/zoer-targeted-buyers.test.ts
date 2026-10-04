import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { validateCatalogSelect } from '../../zoer/backend/src/catalog-reader';
import { SAVED_BC_BID_BUYERS_QUERY } from '../zoer/dashboard/buyer-query';

describe('BC Bid targeted refresh buyer list', () => {
  it('passes the host catalog reader and lists only BC Bid buyers, most notices first', () => {
    const { statement, parameters } = SAVED_BC_BID_BUYERS_QUERY;
    expect(() => validateCatalogSelect(statement, parameters)).not.toThrow();
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,title TEXT,data TEXT)');
    const put = db.prepare('INSERT INTO records VALUES(?,?,?,?)');
    put.run('a', 'opportunity', 'a', JSON.stringify({ issuedBy: 'City of Victoria' }));
    put.run('b', 'opportunity', 'b', JSON.stringify({ issuedBy: 'City of Victoria', sourceId: 'bc-bid' }));
    put.run('c', 'opportunity', 'c', JSON.stringify({ issuedBy: 'Island Health', sourceId: '' }));
    put.run('d', 'opportunity', 'd', JSON.stringify({ issuedBy: 'City of Nanaimo', sourceId: 'bidsandtenders' }));
    put.run('e', 'award', 'e', JSON.stringify({ issuedBy: 'BC Hydro' }));
    expect(db.prepare(statement).all(...parameters)).toEqual([{ name: 'City of Victoria', count: 2 }, { name: 'Island Health', count: 1 }]);
  });
});
