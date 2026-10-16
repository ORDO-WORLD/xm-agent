import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPaginationPages } from '../lib/pagination.ts';

test('desktop shows ten consecutive numbers and the last page', () => {
  assert.deepEqual(getPaginationPages(1,15,'desktop'),[1,2,3,4,5,6,7,8,9,10,'…',15]);
  assert.deepEqual(getPaginationPages(10,15,'desktop'),[1,2,3,4,5,6,7,8,9,10,'…',15]);
  assert.deepEqual(getPaginationPages(11,15,'desktop'),[2,3,4,5,6,7,8,9,10,11,'…',15]);
  assert.deepEqual(getPaginationPages(12,15,'desktop'),[3,4,5,6,7,8,9,10,11,12,'…',15]);
  assert.deepEqual(getPaginationPages(15,15,'desktop'),[6,7,8,9,10,11,12,13,14,15]);
});
test('mobile retains the existing sliding three-number pattern', () => {
  assert.deepEqual(getPaginationPages(1,15,'mobile'),[1,2,3]);
  assert.deepEqual(getPaginationPages(4,15,'mobile'),[3,4,5]);
  assert.deepEqual(getPaginationPages(15,15,'mobile'),[13,14,15]);
});
test('small totals and single-page gaps do not duplicate pages or add unnecessary dots', () => {
  for (const mode of ['desktop','tablet','mobile']) {
    assert.deepEqual(getPaginationPages(1,1,mode),[1]);
    assert.deepEqual(getPaginationPages(2,2,mode),[1,2]);
  }
  assert.deepEqual(getPaginationPages(1,11,'desktop'),[1,2,3,4,5,6,7,8,9,10,11]);
  assert.deepEqual(getPaginationPages(1,9,'desktop'),[1,2,3,4,5,6,7,8,9]);
});
test('every current page is visible and all displayed numbers stay valid', () => {
  for (const mode of ['desktop','tablet','mobile']) for (let count=1;count<=100;count++) for(let page=1;page<=count;page++) {
    const pages=getPaginationPages(page,count,mode), numbers=pages.filter(value=>typeof value==='number');
    assert.ok(numbers.includes(page));assert.equal(new Set(numbers).size,numbers.length);
    assert.ok(numbers.every(number=>number>=1&&number<=count));
    if(mode==='mobile')assert.ok(numbers.length<=3);
  }
});
