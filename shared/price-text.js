/** Asking-price display and scrape cleanup for Nettikone leftovers. */

export function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return `${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`;
}

export function looksGarbledPriceText(text) {
  const groups = numericGroups(text);
  if (groups.length < 3) return false;
  return groups[0].length <= 2 && groups[1].length < 3;
}

export function recoverAskingPrice(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (!looksGarbledPriceText(raw)) {
    const match = raw.match(/\b\d[\d\s.,]*(?:€|EUR)/i);
    return match?.[0]?.trim() || raw;
  }

  const groups = String(raw)
    .replace(/€|EUR/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const rest = groups.slice(1).join(' ');
  if (!rest) return null;
  const recovered = `${rest} €`;
  if (looksGarbledPriceText(recovered)) return null;
  return recovered;
}

export function displayAskingPrice(priceText, priceEur) {
  const amount = Number(priceEur);
  if (Number.isFinite(amount) && amount >= 20 && amount <= 5_000_000) {
    return formatEuro(amount);
  }
  if (looksGarbledPriceText(priceText)) return '—';
  return priceText || '-';
}

export function storedPriceText(priceText, priceEur) {
  const amount = Number(priceEur);
  if (Number.isFinite(amount) && amount >= 20 && amount <= 2_000_000) {
    return formatEuro(amount);
  }
  if (looksGarbledPriceText(priceText)) return '';
  return priceText || '';
}

function numericGroups(text) {
  return String(text || '')
    .replace(/€|EUR/gi, '')
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/\D/g, ''))
    .filter(Boolean);
}
