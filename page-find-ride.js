import {
  mountChrome, requireAuth, currentProfile, $, esc, rideCard, emptyState,
  loadingState, errorState, toastError, toastOk,
} from './ui.js';
import { searchRidesNearby } from './rides.js';
import { currentPosition, reverseGeocode, geocode } from './geocode.js';

await mountChrome();
if (!(await requireAuth())) throw new Error('redirecting');

const results = $('#results');
let lastRides = [];

/** The point the mile radius is measured from. null = no distance filter. */
let anchor = null;   // { lat, lng, label }

/* --------------------------------------------------------------- filters -- */
const params = new URLSearchParams(location.search);
if (params.get('from')) $('#origin').value = params.get('from');
if (params.get('to'))   $('#destination').value = params.get('to');
if (params.get('date')) $('#date').value = params.get('date');

const profile = await currentProfile();
if (profile?.home_lat != null && profile?.home_lng != null) {
  const btn = $('#useHomeBtn');
  btn.textContent = `📌 Near ${profile.home_area || 'my area'}`;
  btn.classList.remove('hidden');
  btn.addEventListener('click', () => setAnchor({
    lat: profile.home_lat, lng: profile.home_lng,
    label: profile.home_area || 'your saved area',
  }));
}

function setAnchor(next) {
  anchor = next;
  const status = $('#locationStatus');
  if (anchor) {
    status.innerHTML = `Measuring from <strong>${esc(anchor.label)}</strong>.`;
    $('#radiusWrap').classList.remove('hidden');
    $('#clearLocationBtn').classList.remove('hidden');
  } else {
    status.textContent = 'Set a location to filter rides by how far their pickup point is from you.';
    $('#radiusWrap').classList.add('hidden');
    $('#clearLocationBtn').classList.add('hidden');
  }
  run();
}

$('#radius').addEventListener('input', (e) => {
  $('#radiusOut').textContent = `Within ${e.target.value} mi`;
});
$('#radius').addEventListener('change', run);

$('#useLocationBtn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Locating…';
  try {
    const pos = await currentPosition();
    const label = await reverseGeocode(pos.lat, pos.lng);
    setAnchor({ ...pos, label: label || 'your current location' });
    toastOk('Using your current location');
  } catch (err) {
    toastError(err.message || 'Could not get your location.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span aria-hidden="true">📍</span> Use my location';
  }
});

$('#clearLocationBtn').addEventListener('click', () => setAnchor(null));

/**
 * Typing a start location and pressing Search also sets the radius anchor, so
 * "Frisco + within 10 miles" behaves the way people expect.
 */
async function anchorFromOriginText() {
  const text = $('#origin').value.trim();
  if (!text || anchor) return;
  const pos = await geocode(text);
  if (pos) {
    anchor = { ...pos, label: text };
    $('#locationStatus').innerHTML = `Measuring from <strong>${esc(text)}</strong>.`;
    $('#radiusWrap').classList.remove('hidden');
    $('#clearLocationBtn').classList.remove('hidden');
  }
}

/* --------------------------------------------------------------- results -- */
function sortRides(rides) {
  const mode = $('#sort').value;
  const copy = [...rides];
  if (mode === 'distance') {
    return copy.sort((a, b) =>
      (a.distance_miles ?? Infinity) - (b.distance_miles ?? Infinity));
  }
  if (mode === 'seats')    return copy.sort((a, b) => b.seats_remaining - a.seats_remaining);
  if (mode === 'cheapest') return copy.sort((a, b) => a.contribution_amount - b.contribution_amount);
  if (mode === 'rating')   return copy.sort((a, b) => (b.driver?.rating_avg || 0) - (a.driver?.rating_avg || 0));
  return copy.sort((a, b) => new Date(a.depart_at) - new Date(b.depart_at));
}

function distanceChip(ride) {
  if (ride.distance_miles == null) return '';
  const m = Number(ride.distance_miles);
  const text = m < 0.1 ? 'right here' : `${m < 10 ? m.toFixed(1) : Math.round(m)} mi away`;
  return `<span class="badge badge-brand">📍 ${text}</span>`;
}

function render(rides) {
  lastRides = rides;

  if (!rides.length) {
    $('#resultCount').textContent = '';
    results.innerHTML = emptyState(
      '🔍', 'No rides found. Try changing your search.',
      anchor
        ? `Nothing starts within ${$('#radius').value} miles of ${anchor.label}. Widen the radius, clear the date, or post the trip yourself.`
        : 'Widen the date, clear a filter, or drop the contribution limit. If nobody is going your way, post the trip yourself and let people join you.',
      `<div class="row mt-3" style="justify-content:center">
         <button class="btn btn-secondary" id="emptyClear">Clear all filters</button>
         <a class="btn btn-primary" href="post-ride.html">Post a Ride</a></div>`
    );
    $('#emptyClear')?.addEventListener('click', () => $('#clearBtn').click());
    return;
  }

  const open = rides.filter((r) => r.seats_remaining > 0).length;
  const filtered = hasFilters();
  $('#resultCount').innerHTML =
    `<strong>${rides.length}</strong> ${filtered ? 'matching' : 'current'} ride${rides.length === 1 ? '' : 's'}`
    + ` · ${open} with seats free`
    + (anchor ? ` · within ${$('#radius').value} mi of ${esc(anchor.label)}` : '');

  results.innerHTML = `<div class="grid grid-3">${
    sortRides(rides).map((r) => {
      const card = rideCard(r);
      // slot the distance chip in beside the seat badge
      return r.distance_miles == null
        ? card
        : card.replace('<div class="ride-meta">', `<div class="ride-meta">${distanceChip(r)}`);
    }).join('')
  }</div>`;
}

function hasFilters() {
  return !!($('#origin').value.trim() || $('#destination').value.trim() || $('#date').value
    || $('#timeFrom').value || $('#timeTo').value || $('#maxContribution').value
    || Number($('#minSeats').value) > 1 || anchor);
}

/* ------------------------------------------------------------------ load -- */
async function run() {
  results.innerHTML = loadingState('Loading rides…', 6);
  $('#resultCount').textContent = '';
  try {
    const rides = await searchRidesNearby({
      lat: anchor?.lat,
      lng: anchor?.lng,
      radiusMiles: anchor ? Number($('#radius').value) : null,
      origin: anchor ? '' : $('#origin').value,   // radius replaces text match on origin
      destination: $('#destination').value,
      date: $('#date').value || null,
      timeFrom: $('#timeFrom').value || null,
      timeTo: $('#timeTo').value || null,
      minSeats: Number($('#minSeats').value),
      maxContribution: $('#maxContribution').value,
      includeFull: !$('#hideFull').checked,
    });
    render(rides);
  } catch (err) {
    toastError(err);
    results.innerHTML = errorState(err, 'retryFind');
    $('#retryFind').addEventListener('click', run);
  }
}

$('#searchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await anchorFromOriginText();
  run();
});
$('#sort').addEventListener('change', () => render(lastRides));
$('#hideFull').addEventListener('change', run);
$('#clearBtn').addEventListener('click', () => {
  $('#searchForm').reset();
  $('#hideFull').checked = true;
  $('#radiusOut').textContent = 'Within 10 mi';
  setAnchor(null);   // also triggers run()
});

// First paint shows every current ride, with no filters applied.
run();
