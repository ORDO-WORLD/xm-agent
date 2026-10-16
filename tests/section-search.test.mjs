import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingSections, nextSectionIndex } from '../lib/section-search-utils.ts';

const sections = [
  { id: 'company', tab: 'umum', label: 'Nama company' },
  { id: 'mode', tab: 'umum', label: 'Mode pencocokan otomatis' },
  { id: 'keywords', tab: 'umum', label: 'Kata kunci pencarian' },
  { id: 'weights', tab: 'pencocokan', label: 'Bobot skor' },
  { id: 'token', tab: 'integrasi', label: 'Token company' },
];

test('search only returns matching section labels in the active tab', () => {
  assert.deepEqual(matchingSections(sections, 'umum', '  COMPANY ').map((item) => item.id), ['company']);
  assert.deepEqual(matchingSections(sections, 'integrasi', 'company').map((item) => item.id), ['token']);
  assert.deepEqual(matchingSections(sections, 'umum', 'skor'), []);
});

test('partial wording returns all matching sections in section order', () => {
  assert.deepEqual(matchingSections(sections, 'umum', 'penco').map((item) => item.id), ['mode']);
  assert.deepEqual(matchingSections(sections, 'umum', 'nama company').map((item) => item.id), ['company']);
  assert.deepEqual(matchingSections(sections, 'umum', 'a').map((item) => item.id), ['company', 'mode', 'keywords']);
});

test('empty, whitespace and unmatched searches have no targets', () => {
  for (const query of ['', '   ', 'tidak ditemukan']) assert.deepEqual(matchingSections(sections, 'umum', query), []);
});

test('next and previous wrap in both directions and tolerate zero or one result', () => {
  assert.equal(nextSectionIndex(0, 1, 3), 1);
  assert.equal(nextSectionIndex(2, 1, 3), 0);
  assert.equal(nextSectionIndex(0, -1, 3), 2);
  assert.equal(nextSectionIndex(2, -1, 3), 1);
  assert.equal(nextSectionIndex(0, 1, 0), 0);
  assert.equal(nextSectionIndex(0, -1, 1), 0);
});

test('saved sales names and phone numbers are searchable only in the Sales tab', () => {
  const sales = [
    { id: 'name', tab: 'sales', label: 'Budi Santoso' },
    { id: 'phone', tab: 'sales', label: '+6281234567890', phone: '6281234567890' },
    { id: 'other', tab: 'umum', label: 'Budi Santoso' },
  ];
  assert.deepEqual(matchingSections(sales, 'sales', 'BUDI').map((item) => item.id), ['name']);
  for (const query of ['081234567890', '6281234567890', '+62 812-3456-7890', '3456']) {
    assert.deepEqual(matchingSections(sales, 'sales', query).map((item) => item.id), ['phone']);
  }
  assert.deepEqual(matchingSections(sales, 'umum', '081234567890'), []);
  assert.deepEqual(matchingSections(sales, 'sales', '0999999'), []);
});
