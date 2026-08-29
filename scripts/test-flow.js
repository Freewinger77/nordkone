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

if (keys.includes('won')) {
  console.error('zero Deal won should not render a node', keys);
  failed += 1;
}

for (const needed of ['messaged->replied', 'replied->interested', 'replied->review', 'interested->await', 'interested->booked', 'interested->lost']) {
  if (!links.includes(needed)) {
    console.error('missing link', needed, links);
    failed += 1;
  }
}

if (links.some((link) => link.includes('won') || link.startsWith('replied->booked') || link.startsWith('replied->lost') || link.startsWith('booked->'))) {
  console.error('zero or skip links should not render', links);
  failed += 1;
}

const withWon = buildFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  interested: 17,
  notint: 11,
  review: 1,
  won: 3,
  lost: 4,
  booked: 2,
  await: 17,
});
if (!withWon.nodes.some((node) => node.k === 'won') || !withWon.links.some((link) => link.from === 'interested' && link.to === 'won')) {
  console.error('positive Deal won should render from Interested');
  failed += 1;
}

const interested = flow.nodes.find((node) => node.k === 'interested');
const lost = flow.nodes.find((node) => node.k === 'lost');
const awaiting = flow.nodes.find((node) => node.k === 'await');
if (lost.y + 1 < interested.y) {
  console.error('Deal lost sits above Interested', { lost: lost.y, interested: interested.y });
  failed += 1;
}
if (awaiting.y > lost.y) {
  console.error('Awaiting booking should sit above Deal lost', { awaiting: awaiting.y, lost: lost.y });
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
