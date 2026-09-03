import assert from 'node:assert/strict';
import {
  classifyListing,
  defaultOutboundFilters,
  listingMatchesOutboundFilters,
  parseOutboundFilters,
} from '../shared/machine-class.js';

assert.equal(classifyListing({ department: 'Kaivinkone', category: 'kaivinkone' }), 'earthmoving');
assert.equal(classifyListing({ machine_title: 'Volvo L90H', department: 'Maarakennus' }), 'earthmoving');
assert.equal(classifyListing({ machine_title: 'Merlo 30.10 kurottaja' }), 'telehandlers');
assert.equal(classifyListing({ department: 'Nosturit', machine_title: 'Haulotte HA 20 PX' }), 'cranes');
assert.equal(classifyListing({ machine_title: 'Valtra N174', department: 'Maatalouskoneet' }), 'agriculture');
assert.equal(classifyListing({ machine_title: 'Iveco 70c21', department: 'Kuljetuskalusto' }), 'transport');
assert.equal(classifyListing({ machine_title: 'Laten Kuokkakauha 1500mm' }), 'attachments');
assert.equal(classifyListing({ raw_data: { machine_class: 'forestry' }, machine_title: 'Whatever' }), 'forestry');

const all = defaultOutboundFilters();
assert.equal(listingMatchesOutboundFilters({ department: 'Kaivinkone', price_eur: 12000 }, all), true);

const earthOnly = parseOutboundFilters({ machine_classes: ['earthmoving'], price_min: 10000, price_max: 80000 });
assert.equal(listingMatchesOutboundFilters({ department: 'Kaivinkone', price_eur: 25000 }, earthOnly), true);
assert.equal(listingMatchesOutboundFilters({ department: 'Kaivinkone', price_eur: 5000 }, earthOnly), false);
assert.equal(listingMatchesOutboundFilters({ department: 'Nosturit', price_eur: 25000 }, earthOnly), false);
assert.equal(listingMatchesOutboundFilters({ department: 'Kaivinkone', price_eur: null }, earthOnly), true);

const parsed = parseOutboundFilters({
  copy_variants: { outbound_filters: { machine_classes: ['Cranes', 'earthmoving', 'nope'], price_min: '15000' } },
});
assert.deepEqual(parsed.machine_classes, ['cranes', 'earthmoving']);
assert.equal(parsed.price_min, 15000);
assert.equal(parsed.price_max, null);

console.log('machine-class tests passed');
