import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimTeamGuideHint, dismissTeamGuideHint, resetTeamGuideSession } from '../lib/team-guide-hint.ts';

function storage() {
  const map = new Map();
  return { get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}

test('automatic hint is shown once per account/login and returns after session reset', () => {
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  assert.equal(claimTeamGuideHint('account-a'), true);
  assert.equal(claimTeamGuideHint('account-a'), false);
  assert.equal(claimTeamGuideHint('account-b'), true);
  window.sessionStorage.setItem('xm.manage', 'kept');
  resetTeamGuideSession();
  assert.equal(claimTeamGuideHint('account-a'), true);
  assert.equal(window.sessionStorage.getItem('xm.manage'), 'kept');
});

test('explicit close stays dismissed after logout and only applies to that account', () => {
  globalThis.window = { localStorage: storage(), sessionStorage: storage() };
  dismissTeamGuideHint('account-a');
  resetTeamGuideSession();
  assert.equal(claimTeamGuideHint('account-a'), false);
  assert.equal(claimTeamGuideHint('account-b'), true);
});
