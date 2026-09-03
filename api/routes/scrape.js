import { Router } from 'express';
import { runCatalogSync, runScrape } from '../../scripts/scrape-nettikone.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

router.get('/run', run);
router.post('/run', run);
router.get('/sync', syncCatalog);
router.post('/sync', syncCatalog);

async function run(req, res) {
  const targetNew = clamp(
    Number(req.query.targetNew || req.query.target_new || req.body?.targetNew || process.env.SCRAPE_TARGET_NEW || 40),
    1,
    200
  );
  const maxPages = clamp(
    Number(
      req.query.maxPages ||
        req.query.max_pages ||
        req.query.pages ||
        req.body?.maxPages ||
        process.env.SCRAPE_MAX_PAGES ||
        40
    ),
    1,
    80
  );
  const maxListings = clamp(
    Number(
      req.query.maxListings ||
        req.query.max_listings ||
        req.query.limit ||
        req.body?.maxListings ||
        process.env.SCRAPE_MAX_LISTINGS ||
        Math.max(targetNew * 2, 40)
    ),
    targetNew,
    200
  );
  const category = String(req.query.category || req.body?.category || process.env.NETTIKONE_DEFAULT_CATEGORY || 'kaivinkone');
  const postedBy = String(req.query.posted_by || req.query.postedBy || req.body?.postedBy || process.env.NETTIKONE_DEFAULT_POSTED_BY || 'S');

  const maxMs = clamp(Number(req.query.maxMs || req.body?.maxMs || process.env.SCRAPE_MAX_MS || 270000), 8000, 290000);

  const stats = await runScrape({
    category,
    postedBy,
    targetNew,
    maxPages,
    maxListings,
    maxMs,
    scanAllPages: true,
  });

  res.json({
    ok: true,
    category,
    postedBy,
    targetNew,
    maxPages,
    maxListings,
    maxMs,
    stats,
  });
}

async function syncCatalog(req, res) {
  const category = String(req.query.category || req.body?.category || process.env.NETTIKONE_DEFAULT_CATEGORY || 'kaivinkone');
  const postedBy = String(req.query.posted_by || req.query.postedBy || req.body?.postedBy || process.env.NETTIKONE_DEFAULT_POSTED_BY || 'S');
  const maxPages = clamp(Number(req.query.maxPages || req.body?.maxPages || 300), 1, 400);
  const maxMs = clamp(Number(req.query.maxMs || req.body?.maxMs || 540000), 15000, 590000);
  const maxNewListings = clamp(Number(req.query.maxNewListings || req.body?.maxNewListings || 500), 0, 800);
  const writeSnapshot = req.query.snapshot !== 'false' && req.body?.snapshot !== false;
  const snapshotPath = writeSnapshot ? path.join(rootDir, 'nk-catalog-active.json') : null;

  const result = await runCatalogSync({
    category,
    postedBy,
    maxPages,
    maxMs,
    maxNewListings,
    snapshotPath,
  });

  res.json({
    ok: true,
    category,
    postedBy,
    maxPages,
    maxMs,
    snapshot_path: snapshotPath,
    stats: result.stats,
    active_count: result.snapshot?.active_ids?.length || result.stats.active_on_nettikone,
  });
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export default router;
