import assert from 'node:assert/strict';
import {
  displayAskingPrice,
  formatEuro,
  looksGarbledPriceText,
  recoverAskingPrice,
  storedPriceText,
} from '../shared/price-text.js';

assert.equal(looksGarbledPriceText('25 900 €'), false);
assert.equal(looksGarbledPriceText('6 250 €'), false);
assert.equal(looksGarbledPriceText('1 234 567 €'), false);
assert.equal(looksGarbledPriceText('12 345 678 €'), false);
assert.equal(looksGarbledPriceText('95 25 900 €'), true);
assert.equal(looksGarbledPriceText('26 6 250 €'), true);
assert.equal(looksGarbledPriceText('00 23 870 €'), true);
assert.equal(looksGarbledPriceText('77 4 700 €'), true);

assert.equal(recoverAskingPrice('95 25 900 €'), '25 900 €');
assert.equal(recoverAskingPrice('26 6 250 €'), '6 250 €');
assert.equal(recoverAskingPrice('25 900 €'), '25 900 €');

assert.equal(displayAskingPrice('95 25 900 €', 25900), '25 900 €');
assert.equal(displayAskingPrice('26 6 250 €', 6250), '6 250 €');
assert.equal(displayAskingPrice('1 600 €', 1600), '1 600 €');
assert.equal(displayAskingPrice('95 25 900 €', null), '—');
assert.equal(displayAskingPrice('95 25 900 €', 2.9), '—');
assert.equal(formatEuro(25900), '25 900 €');

assert.equal(storedPriceText('95 25 900 €', 25900), '25 900 €');
assert.equal(storedPriceText('26 3 189 €', 3189), '3 189 €');
assert.equal(storedPriceText('1 600 €', 1600), '1 600 €');
assert.equal(storedPriceText('95 25 900 €', 2.9), '');

console.log('price-text tests passed');
