import { buildFlow } from '../client/src/lib/desk.js';

const flow = buildFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  interested: 17,
  notint: 11,
  review: 1,
  won: 0,
  lost: 4,
  booked: 2,
  await: 17,
});

let failed = 0;
const keys = flow.nodes.map((node) => node.k);
const links = flow.links.map((link) => `${link.from}->${link.to}`);

for (const needed of ['messaged', 'replied', 'noreply', 'interested', 'notint', 'booked', 'review', 'lost']) {
  if (!keys.includes(needed)) {
    console.error('missing node', needed);
    failed += 1;
  }
}

for (const needed of ['messaged->replied', 'replied->interested', 'interested->booked', 'interested->review', 'booked->lost']) {
  if (!links.includes(needed)) {
    console.error('missing link', needed, links);
    failed += 1;
  }
}

if (links.some((link) => link.startsWith('replied->booked') || link.startsWith('replied->lost') || link.startsWith('replied->won'))) {
  console.error('replied should not skip to outcomes', links);
  failed += 1;
}

for (const link of flow.links) {
  const from = flow.nodes.find((node) => node.k === link.from);
  const to = flow.nodes.find((node) => node.k === link.to);
  if (to.x <= from.x) {
    console.error('link is not left-to-right', link);
    failed += 1;
  }
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ok', { nodes: keys, links });
