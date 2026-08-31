import { Router } from 'express';
import { createSupabase } from '../lib/supabase.js';
import { CLIENT_KEY } from '../lib/campaign.js';
import { defaultOutboundFilters, parseOutboundFilters } from '../../shared/machine-class.js';

const router = Router();

router.get('/', async (_req, res) => {
  const supabase = createSupabase();
  const { data, error } = await supabase
    .from('campaign_client_config')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .maybeSingle();

  if (error) throw error;
  res.json({ settings: withOutboundFilters(data) });
});

router.put('/', async (req, res) => {
  const supabase = createSupabase();
  const allowed = ['outbound_enabled', 'daily_cap', 'campaign_name', 'outbound_filters'];
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

  const { data: existing, error: existingError } = await supabase
    .from('campaign_client_config')
    .select('*')
    .eq('client_key', CLIENT_KEY)
    .maybeSingle();

  if (existingError) throw existingError;

  const payload = { updated_at: new Date().toISOString() };
  if ('outbound_enabled' in updates) payload.outbound_enabled = updates.outbound_enabled;
  if ('daily_cap' in updates) payload.daily_cap = updates.daily_cap;
  if ('campaign_name' in updates) payload.campaign_name = updates.campaign_name;
  if ('outbound_filters' in updates) {
    payload.copy_variants = {
      ...(existing?.copy_variants && typeof existing.copy_variants === 'object' ? existing.copy_variants : {}),
      outbound_filters: parseOutboundFilters(updates.outbound_filters),
    };
  }

  const { data, error } = await supabase
    .from('campaign_client_config')
    .update(payload)
    .eq('client_key', CLIENT_KEY)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  res.json({ ok: true, settings: withOutboundFilters(data) });
});

export function withOutboundFilters(row) {
  if (!row) return { outbound_filters: defaultOutboundFilters() };
  return {
    ...row,
    outbound_filters: parseOutboundFilters(row),
  };
}

export default router;
