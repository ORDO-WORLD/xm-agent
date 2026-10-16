import test from 'node:test';
import assert from 'node:assert/strict';
import { actorKey, returnRoute, startUrl } from '../lib/account-sync.mjs';

test('identity distinguishes members, company, role and workspace', () => {
  const one = { id: 'one', role: 'user', workspace_id: 'aa-7' };
  assert.notEqual(actorKey(one), actorKey({ ...one, id: 'two' }));
  assert.notEqual(actorKey(one), actorKey({ ...one, workspace_id: 'aa-8' }));
  assert.notEqual(actorKey(one), actorKey({ ...one, role: 'company_admin' }));
  assert.equal(actorKey(one), actorKey({ ...one, display_name: 'Renamed' }));
});
test('only internal hash routes survive sign-in', () => {
  assert.equal(returnRoute('#/cocokkan?arah=buyer&id=B-123'), '/#/cocokkan?arah=buyer&id=B-123');
  for (const bad of ['https://evil.test', '//evil.test', '#/unknown', '#/cocokkan\r\nLocation:evil']) assert.equal(returnRoute(bad), '/');
  assert.equal(new URL(startUrl('#/stok'), 'https://xm.test').searchParams.get('next'), '/#/stok');
});
