import { buildFlow } from '../client/src/lib/desk.js';

const flow = buildFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  callback: 14,
  notint: 11,
  review: 1,
  won: 0,
  lost: 4,
  booked: 2,
});

let failed = 0;
const keys = flow.nodes.map((node) => node.k);
const links = flow.links.map((link) => `${link.from}->${link.to}`);

for (const needed of ['messaged', 'replied', 'noreply', 'callback', 'booked', 'review', 'lost', 'notint']) {
  if (!keys.includes(needed)) {
    console.error('missing node', needed);
    failed += 1;
  }
}

if (keys.includes('won') || keys.includes('interested') || keys.includes('await')) {
  console.error('removed or zero nodes should not render', keys);
  failed += 1;
}

for (const needed of ['messaged->replied', 'replied->callback', 'replied->booked', 'replied->review', 'replied->lost', 'replied->notint']) {
  if (!links.includes(needed)) {
    console.error('missing link', needed, links);
    failed += 1;
  }
}

if (links.some((link) => link.includes('won') || link.includes('interested') || link.includes('await') || link.startsWith('callback->') || link.startsWith('booked->'))) {
  console.error('zero or skip links should not render', links);
  failed += 1;
}

const withWon = buildFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  callback: 14,
  notint: 11,
  review: 1,
  won: 3,
  lost: 4,
  booked: 2,
});
if (!withWon.nodes.some((node) => node.k === 'won') || !withWon.links.some((link) => link.from === 'replied' && link.to === 'won')) {
  console.error('positive Deal won should render from Replied');
  failed += 1;
}

const messaged = flow.nodes.find((node) => node.k === 'messaged');
const replied = flow.nodes.find((node) => node.k === 'replied');
const callback = flow.nodes.find((node) => node.k === 'callback');
const lost = flow.nodes.find((node) => node.k === 'lost');
if (callback.x < flow.vw * 0.55) {
  console.error('last column should sit on the right of the card', { x: callback.x, vw: flow.vw });
  failed += 1;
}
if (replied.x - messaged.x < 200) {
  console.error('columns are bunched too tightly', { messaged: messaged.x, replied: replied.x });
  failed += 1;
}
if (callback.y + 1 < replied.y) {
  console.error('Callback sits above Replied', { callback: callback.y, replied: replied.y });
  failed += 1;
}
if (callback.y > lost.y) {
  console.error('Callback should sit above Deal lost', { callback: callback.y, lost: lost.y });
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
