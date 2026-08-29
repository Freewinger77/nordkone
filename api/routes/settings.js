import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { CLIENT_KEY } from '../lib/campaign.js';

const router = Router();

router.get('/', async (_req, res) => {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from('campaign_client_config')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .maybeSingle();

  if (error) throw error;
  res.json({ settings: data || null });
});

router.put('/', async (req, res) => {
  const supabase = createSupabase();
  const allowed = ['outbound_enabled', 'daily_cap', 'campaign_name'];
  const input = req.body?.settings || req.body || {};
  const updates = Object.fromEntries(
    Object.entries(input).filter(([key]) => allowed.includes(key))
  );

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No supported settings provided' });
  }

  if ('outbound_enabled' in updates) {
    updates.outbound_enabled = updates.outbound_enabled === true || updates.outbound_enabled === 'true';
  }
  if ('daily_cap' in updates) {
    const cap = Number(updates.daily_cap);
    updates.daily_cap = Number.isFinite(cap) ? Math.max(0, Math.min(cap, 500)) : 0;
  }

  const { data, error } = await supabase
    .from('campaign_client_config')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('client_key', CLIENT_KEY)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  res.json({ ok: true, settings: data });
});

export default router;
