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

const order = Object.fromEntries(flow.nodes.map((node, index) => [node.k, index]));
const columns = {};
for (const node of flow.nodes) {
  (columns[node.x] ||= []).push(node.k);
}

let failed = 0;
for (const link of flow.links) {
  const from = flow.nodes.find((node) => node.k === link.from);
  const to = flow.nodes.find((node) => node.k === link.to);
  if (!from || !to) {
    console.error('missing node', link);
    failed += 1;
    continue;
  }
  if (to.x <= from.x) {
    console.error('link goes backwards or skips left', link);
    failed += 1;
  }
  const siblings = columns[to.x] || [];
  const next = siblings[siblings.indexOf(link.from === 'messaged' ? (link.to === 'replied' ? 'replied' : 'noreply') : link.to)];
  if (next && order[link.to] < order[link.from] && link.from !== 'messaged') {
    console.error('target appears above source', link);
    failed += 1;
  }
}

const xs = [...new Set(flow.nodes.map((node) => node.x))];
if (xs.length !== 3) {
  console.error('expected 3 columns', xs);
  failed += 1;
}
if (flow.nodes.some((node) => node.k === 'await')) {
  console.error('await should not be a skip-column node');
  failed += 1;
}
if (flow.links.some((link) => link.from === 'replied' && ['won', 'lost', 'booked', 'await'].includes(link.to) && !flow.nodes.some((node) => node.k === link.to && node.x === xs[2]))) {
  console.error('outcome link not in last column');
  failed += 1;
}

const repliedOut = flow.links.filter((link) => link.from === 'replied').map((link) => link.to);
const lastCol = columns[xs[2]];
if (repliedOut.join(',') !== lastCol.join(',')) {
  console.error('replied outputs should match last-column order', repliedOut, lastCol);
  failed += 1;
}

if (failed) {
  console.error(`FAILED ${failed}`);
  process.exit(1);
}
console.log('ok', { nodes: flow.nodes.map((node) => node.k), links: flow.links.map((link) => `${link.from}->${link.to}`) });
