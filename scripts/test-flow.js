import { buildFlow, buildVerticalFlow, buildWeek } from '../client/src/lib/desk.js';

const flow = buildFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  callback: 10,
  notint: 11,
  review: 1,
  won: 0,
  lost: 4,
  booked: 2,
  awaitReply: 7,
  opportunities: 12,
});

let failed = 0;
const keys = flow.nodes.map((node) => node.k);
const links = flow.links.map((link) => `${link.from}->${link.to}`);

for (const needed of ['messaged', 'replied', 'noreply', 'opportunities', 'notint', 'review', 'awaitReply', 'booked', 'callback', 'lost']) {
  if (!keys.includes(needed)) {
    console.error('missing node', needed);
    failed += 1;
  }
}

if (keys.includes('won') || keys.includes('interested') || keys.includes('await')) {
  console.error('removed or zero nodes should not render', keys);
  failed += 1;
}

for (const needed of [
  'messaged->replied',
  'replied->opportunities',
  'replied->notint',
  'replied->review',
  'replied->awaitReply',
  'opportunities->booked',
  'opportunities->callback',
  'replied->lost',
]) {
  if (!links.includes(needed)) {
    console.error('missing link', needed, links);
    failed += 1;
  }
}

if (links.some((link) => link.includes('won') || link.startsWith('replied->booked') || link.startsWith('replied->callback') || link.startsWith('opportunities->lost'))) {
  console.error('zero or skip links should not render', links);
  failed += 1;
}

const withWon = buildFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  callback: 10,
  notint: 11,
  review: 1,
  won: 3,
  lost: 4,
  booked: 2,
  awaitReply: 7,
  opportunities: 15,
});
if (!withWon.nodes.some((node) => node.k === 'won') || !withWon.links.some((link) => link.from === 'opportunities' && link.to === 'won')) {
  console.error('positive Deal won should render from Opportunities');
  failed += 1;
}

const messaged = flow.nodes.find((node) => node.k === 'messaged');
const replied = flow.nodes.find((node) => node.k === 'replied');
const opportunities = flow.nodes.find((node) => node.k === 'opportunities');
const booked = flow.nodes.find((node) => node.k === 'booked');
const callback = flow.nodes.find((node) => node.k === 'callback');
const lost = flow.nodes.find((node) => node.k === 'lost');
const notint = flow.nodes.find((node) => node.k === 'notint');
if (booked.x < flow.vw * 0.55) {
  console.error('outcome column should sit on the right of the card', { x: booked.x, vw: flow.vw });
  failed += 1;
}
if (replied.x - messaged.x < 180) {
  console.error('columns are bunched too tightly', { messaged: messaged.x, replied: replied.x });
  failed += 1;
}
if (booked.y + 1 < opportunities.y) {
  console.error('Booked sits above Opportunities', { booked: booked.y, opportunities: opportunities.y });
  failed += 1;
}
if (lost.x !== opportunities.x) {
  console.error('Lost / Sold should sit under Replied, not Opportunities', { lost: lost.x, opportunities: opportunities.x, booked: booked.x });
  failed += 1;
}
if (lost.y <= opportunities.y || notint.y <= lost.y) {
  console.error('Lost / Sold order under Replied is wrong', { opportunities: opportunities.y, lost: lost.y, notint: notint.y });
  failed += 1;
}
if (booked.y > callback.y) {
  console.error('Booked / Callback order is wrong', { booked: booked.y, callback: callback.y });
  failed += 1;
}
if (callback.lc - booked.lc < 56 || lost.lc - opportunities.lc < 56) {
  console.error('flow labels are too close', { booked: booked.lc, callback: callback.lc, lost: lost.lc, opportunities: opportunities.lc });
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

const week = buildWeek(0, [], [
  { callbackAt: new Date().toISOString(), machine: 'Lokomo T325C', phone: '+358', listingId: 'lokomo', callback: true },
]);
if (!week.days.some((day) => day.events.some((event) => event.kind === 'callback' && event.machine === 'Lokomo T325C'))) {
  console.error('callback signal should land on its Helsinki day', week);
  failed += 1;
}
if (week.days.flatMap((day) => day.events).some((event) => event.kind === 'booked') === false && !week.count.includes('Call Now')) {
  console.error('week label should mention Call Now', week.count);
  failed += 1;
}

const vFlow = buildVerticalFlow({
  eligible: 511,
  messaged: 48,
  replied: 35,
  noreply: 13,
  callback: 10,
  notint: 11,
  review: 1,
  won: 0,
  lost: 4,
  booked: 2,
  awaitReply: 7,
  opportunities: 12,
});
const vMessaged = vFlow.nodes.find((node) => node.k === 'messaged');
const vReplied = vFlow.nodes.find((node) => node.k === 'replied');
const vOpps = vFlow.nodes.find((node) => node.k === 'opportunities');
const vBooked = vFlow.nodes.find((node) => node.k === 'booked');
if (!vFlow.vertical || vReplied.y <= vMessaged.y || vBooked.y <= vOpps.y) {
  console.error('vertical flow should stack rows downward', { y: { messaged: vMessaged.y, replied: vReplied.y, booked: vBooked.y } });
  failed += 1;
}
if (vMessaged.h >= vMessaged.w || vReplied.x < vMessaged.x - 1) {
  console.error('vertical nodes should be wide bars', vMessaged, vReplied);
  failed += 1;
}
const vLost = vFlow.nodes.find((node) => node.k === 'lost');
const vReview = vFlow.nodes.find((node) => node.k === 'review');
const vAwait = vFlow.nodes.find((node) => node.k === 'awaitReply');
if (vLost.y !== vOpps.y || vLost.y === vBooked.y) {
  console.error('vertical Lost / Sold should sit on the Replied row', { lost: vLost.y, opps: vOpps.y, booked: vBooked.y });
  failed += 1;
}
if (vAwait.x - vReview.x < 60) {
  console.error('crowded vertical labels need more slot room', { review: vReview.x, await: vAwait.x });
  failed += 1;
}
if (vFlow.links.some((link) => {
  const from = vFlow.nodes.find((node) => node.k === link.from);
  const to = vFlow.nodes.find((node) => node.k === link.to);
  return to.y <= from.y;
})) {
  console.error('vertical ribbons should run top to bottom', vFlow.links);
  failed += 1;
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ok', { nodes: keys, links });
