import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import listingsRouter from './routes/listings.js';
import settingsRouter from './routes/settings.js';
import webhooksRouter from './routes/webhooks.js';
import scrapeRouter from './routes/scrape.js';
import authRouter from './routes/auth.js';
import { hasSupabaseConfig } from './lib/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

export function createApp() {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/auth', authRouter);
  app.use('/api', optionalApiKey);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      supabaseConfigured: hasSupabaseConfig(),
      service: 'nordkone-leads',
    });
  });

  app.use('/api', listingsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/scrape', scrapeRouter);

  const distDir = path.join(rootDir, 'dist');
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();

    res.sendFile(path.join(distDir, 'index.html'), (error) => {
      if (error) next();
    });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error',
    });
  });

  return app;
}

function optionalApiKey(req, res, next) {
  const expectedKeys = [process.env.API_KEY, process.env.VITE_API_KEY].filter(Boolean);
  const readOnlyKeys = [process.env.READ_ONLY_API_KEY, process.env.VITE_READ_ONLY_API_KEY].filter(Boolean);
  const cronSecret = process.env.CRON_SECRET;
  if (!expectedKeys.length && !readOnlyKeys.length && !cronSecret) return next();

  const actual = req.get('x-api-key');
  const authorization = req.get('authorization');
  const cronAuthorized = cronSecret && authorization === `Bearer ${cronSecret}`;
  const apiAuthorized = expectedKeys.includes(actual);
  const readOnlyAuthorized = readOnlyKeys.includes(actual);

  if (!apiAuthorized && !cronAuthorized && !readOnlyAuthorized) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  if (readOnlyAuthorized && !apiAuthorized && !cronAuthorized && !isReadOnlyRequest(req)) {
    return res.status(403).json({ error: 'Read-only API key cannot perform this action' });
  }

  return next();
}

function isReadOnlyRequest(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') return false;

  const requestPath = (req.originalUrl || req.path || '').split('?')[0];
  const mountedPath = req.path || '';
  const allowedPrefixes = [
    '/api/health',
    '/api/summary',
    '/api/listings',
    '/api/interested',
    '/api/conversations',
    '/api/calendar-calls',
    '/api/settings',
  ];

  const mountedPrefixes = allowedPrefixes.map((prefix) => prefix.replace(/^\/api/, '') || '/');

  return (
    allowedPrefixes.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)) ||
    mountedPrefixes.some((prefix) => mountedPath === prefix || mountedPath.startsWith(`${prefix}/`))
  );
}

export default createApp();
