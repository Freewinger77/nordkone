/** Nettikone → NordKone outbound classes. Empty filter means every class. */

export const MACHINE_CLASSES = [
  {
    id: 'earthmoving',
    label: 'Earthmoving',
    hint: 'Excavators, loaders, dumpers, dozers, compactors',
  },
  {
    id: 'cranes',
    label: 'Cranes & lifts',
    hint: 'Cranes, personnel lifts, scaffolding',
  },
  {
    id: 'telehandlers',
    label: 'Telehandlers',
    hint: 'Kurottajat and rotating handlers',
  },
  {
    id: 'material_handling',
    label: 'Material handling',
    hint: 'Forklifts, container handlers, sweepers',
  },
  {
    id: 'transport',
    label: 'Trucks & trailers',
    hint: 'Lorries, machine transporters, trailers',
  },
  {
    id: 'agriculture',
    label: 'Tractors & agriculture',
    hint: 'Tractors, farm loaders, implements',
  },
  {
    id: 'forestry',
    label: 'Forestry',
    hint: 'Harvesters, forwarders, forest trailers',
  },
  {
    id: 'attachments',
    label: 'Attachments',
    hint: 'Buckets, hammers, hitch gear',
  },
  {
    id: 'environment',
    label: 'Snow & municipal',
    hint: 'Snow machines, sweepers, property tractors',
  },
  {
    id: 'other',
    label: 'Other',
    hint: 'Workshop, halls, containers, leftover types',
  },
];

export const MACHINE_CLASS_IDS = MACHINE_CLASSES.map((row) => row.id);

export const PRICE_SLIDER_MAX = 500_000;
export const PRICE_SLIDER_STEP = 5_000;

const CLASS_RULES = [
  { id: 'attachments', re: /lisälaite|lisavaruste|lisävaruste|kauha|koura|kahmari|kiinnike|hydrauliikkasylinter|letku|adapteri|hammas|purkukauha|isku|rammer|hydraulivasara|pyörittäjä$|rototilt$|ntp-?\d/i },
  { id: 'telehandlers', re: /kurotta|telehandler|merlo|manitou|jlg ?\d|dieci|rotating handler/i },
  { id: 'cranes', re: /nosturi|henkilönost|skylift|bronto|haulotte|Genie S|nostopöytä|rakennusteline|torninost/i },
  { id: 'forestry', re: /harvester|kuormatraktor|metsätraktor|metsäkone|metsäkärry|forwarder|moottorisaha|raivaussaha/i },
  { id: 'agriculture', re: /traktori|maatalous|puimuri|kylvö|heinäkone|lannoit|valtra|fendt|john deere|new holland|deutz-fahr/i },
  { id: 'transport', re: /kuorma-auto|rekka|perävaunu|puoliperä|vetopöytä|pakettiauto|koneenkuljetus|hinausauto|kuljetuskalusto/i },
  { id: 'environment', re: /lumikone|lumityk|latukone|lakaisukone|ruohonleik|pientraktor|kiinteistötraktor|ympäristö|aura\b/i },
  { id: 'material_handling', re: /trukki|terminaalitraktor|konttikurotta|materiaalinkäsittely/i },
  { id: 'earthmoving', re: /kaivinkone|kaivurikuorma|kuormaaja|dumpperi|puskutraktor|tärylätkä|maantiivistä|asfaltti|betoni(?!element)|murskain|poraus|maarakenn|maansiirto|excavator|wheel loader|backhoe/i },
];

const DEPARTMENT_MAP = {
  kaivinkone: 'earthmoving',
  maarakennus: 'earthmoving',
  nosturit: 'cranes',
  nosturi: 'cranes',
  tyokoneet: 'other',
  'työkoneet': 'other',
  materiaalinkasittely: 'material_handling',
  'materiaalinkäsittely': 'material_handling',
  kuljetuskalusto: 'transport',
  maatalouskoneet: 'agriculture',
  metsakoneet: 'forestry',
  'metsäkoneet': 'forestry',
  ymparistokoneet: 'environment',
  'ympäristökoneet': 'environment',
  vaihtolavat: 'transport',
  korjaamolaitteet: 'other',
  'kontit ja säiliöt': 'other',
  'hallit ja katokset': 'other',
};

export function normalizeMachineClass(value) {
  const id = String(value || '').trim().toLowerCase();
  return MACHINE_CLASS_IDS.includes(id) ? id : null;
}

export function classifyListing(listing = {}) {
  const stored = normalizeMachineClass(listing.machine_class || listing.raw_data?.machine_class);
  if (stored) return stored;

  const hay = [
    listing.department,
    listing.category,
    listing.listing_type,
    listing.machine_title,
    listing.title,
    listing.subtitle,
    listing.listing_url,
    listing.canonical_url,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const dept = String(listing.department || listing.category || '')
    .trim()
    .toLowerCase();
  if (DEPARTMENT_MAP[dept]) return DEPARTMENT_MAP[dept];

  for (const rule of CLASS_RULES) {
    if (rule.re.test(hay)) return rule.id;
  }

  return 'other';
}

export function machineClassMeta(id) {
  return MACHINE_CLASSES.find((row) => row.id === id) || MACHINE_CLASSES[MACHINE_CLASSES.length - 1];
}

export function parseOutboundFilters(input = {}) {
  const source = input.outbound_filters || input.copy_variants?.outbound_filters || input;
  const classes = Array.isArray(source.machine_classes)
    ? [...new Set(source.machine_classes.map(normalizeMachineClass).filter(Boolean))]
    : [];
  const priceMin = parseBound(source.price_min, 0);
  const priceMax = parseBound(source.price_max, null);
  return {
    machine_classes: classes,
    price_min: priceMin,
    price_max: priceMax,
  };
}

export function defaultOutboundFilters() {
  return { machine_classes: [], price_min: 0, price_max: null };
}

export function listingMatchesOutboundFilters(listing, filters = defaultOutboundFilters()) {
  const next = parseOutboundFilters(filters);
  const machineClass = classifyListing(listing);
  if (next.machine_classes.length && !next.machine_classes.includes(machineClass)) return false;

  if (listing.price_eur != null && listing.price_eur !== '') {
    const price = Number(listing.price_eur);
    if (Number.isFinite(price)) {
      if (next.price_min != null && price < next.price_min) return false;
      if (next.price_max != null && price > next.price_max) return false;
    }
  }

  return true;
}

export function formatEuroBound(value, { openMax = false } = {}) {
  if (value == null || (openMax && value >= PRICE_SLIDER_MAX)) return 'No max';
  const amount = Number(value) || 0;
  if (amount >= 1000) return `${Math.round(amount / 1000)}k €`;
  return `${amount} €`;
}

function parseBound(value, fallback) {
  if (value == null || value === '') return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.max(0, Math.round(amount));
}
