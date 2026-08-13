/**
 * Turning place names into coordinates, using Nominatim (OpenStreetMap).
 *
 * Free and keyless, but their usage policy is strict:
 *   - at most one request per second
 *   - identify yourself (browsers send a Referer automatically)
 *   - cache aggressively; don't re-query the same string
 *   - not for heavy commercial use
 *
 * Everything below exists to honour that. If you outgrow Nominatim, this is the
 * only file that changes — swap the two fetch calls for Google/Mapbox and the
 * rest of the app is untouched.
 *
 * No DOM access, so the Expo app can import this as-is.
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org';
const MIN_GAP_MS = 1100;          // Nominatim asks for <= 1 req/sec
const CACHE_KEY = 'carbuddy.geocache.v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;   // a month; places don't move

/* ------------------------------------------------------------------ cache -- */
let memCache = null;

function loadCache() {
  if (memCache) return memCache;
  memCache = {};
  try {
    const raw = globalThis.localStorage?.getItem(CACHE_KEY);
    if (raw) memCache = JSON.parse(raw) || {};
  } catch { memCache = {}; }
  return memCache;
}

function readCache(key) {
  const entry = loadCache()[key];
  if (!entry) return undefined;
  if (Date.now() - entry.t > CACHE_TTL_MS) return undefined;
  return entry.v;
}

function writeCache(key, value) {
  const cache = loadCache();
  cache[key] = { v: value, t: Date.now() };
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch { /* private mode or quota — the in-memory copy still works */ }
}

/* ------------------------------------------------------------ rate limit -- */
let chain = Promise.resolve();
let lastCall = 0;

/** Serialises every outbound request and spaces them at least MIN_GAP_MS apart. */
function queued(fn) {
  const run = chain.then(async () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  // keep the chain alive even when one call rejects
  chain = run.then(() => {}, () => {});
  return run;
}

/* -------------------------------------------------------------- requests -- */
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

async function request(path, params) {
  const url = new URL(ENDPOINT + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Geocoding service returned ${res.status}`);
  return res.json();
}

/**
 * Best match for a place name.
 * @returns {{lat:number,lng:number,label:string}|null} null when nothing matched
 */
export async function geocode(query, { countryCodes = 'us' } = {}) {
  const key = 'g:' + norm(query);
  if (!norm(query)) return null;

  const hit = readCache(key);
  if (hit !== undefined) return hit;

  try {
    const rows = await queued(() => request('/search', {
      q: query, format: 'jsonv2', limit: 1, addressdetails: 1,
      ...(countryCodes ? { countrycodes: countryCodes } : {}),
    }));
    const first = rows?.[0];
    const result = first
      ? { lat: Number(first.lat), lng: Number(first.lon), label: first.display_name }
      : null;
    writeCache(key, result);
    return result;
  } catch (err) {
    // A geocoding outage must never block posting a ride.
    console.warn('Geocoding failed:', err.message);
    return null;
  }
}

/** Up to 5 suggestions, for a type-ahead. */
export async function suggest(query, { countryCodes = 'us', limit = 5 } = {}) {
  if (norm(query).length < 3) return [];
  const key = `s:${limit}:` + norm(query);
  const hit = readCache(key);
  if (hit !== undefined) return hit;

  try {
    const rows = await queued(() => request('/search', {
      q: query, format: 'jsonv2', limit, addressdetails: 1,
      ...(countryCodes ? { countrycodes: countryCodes } : {}),
    }));
    const out = (rows || []).map((r) => ({
      lat: Number(r.lat), lng: Number(r.lon),
      label: r.display_name,
      short: shortLabel(r),
    }));
    writeCache(key, out);
    return out;
  } catch {
    return [];
  }
}

/** Coordinates -> a human place name. Used after "use my location". */
export async function reverseGeocode(lat, lng) {
  const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`;
  const hit = readCache(key);
  if (hit !== undefined) return hit;

  try {
    const row = await queued(() => request('/reverse', {
      lat, lon: lng, format: 'jsonv2', zoom: 14,
    }));
    const label = row ? shortLabel(row) : null;
    writeCache(key, label);
    return label;
  } catch {
    return null;
  }
}

/** "Frisco, Collin County, Texas" rather than the full postal address. */
function shortLabel(row) {
  const a = row.address || {};
  const place = a.city || a.town || a.village || a.suburb || a.neighbourhood
             || a.hamlet || a.county || row.name;
  const region = a.state_code || a.state;
  return [place, region].filter(Boolean).join(', ') || row.display_name;
}

/** Browser GPS, wrapped in a promise. Expo: swap for expo-location. */
export function currentPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!globalThis.navigator?.geolocation) {
      reject(new Error('This device cannot share its location.'));
      return;
    }
    globalThis.navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new Error(
        err.code === 1 ? 'Location permission was denied.'
        : err.code === 3 ? 'Timed out getting your location.'
        : 'Could not get your location.')),
      { enableHighAccuracy: false, timeout, maximumAge: 300000 }
    );
  });
}

/** Straight-line miles. Mirrors public.miles_between() in the database. */
export function milesBetween(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((n) => n == null || Number.isNaN(n))) return null;
  const R = 3958.7613;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
          + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}
