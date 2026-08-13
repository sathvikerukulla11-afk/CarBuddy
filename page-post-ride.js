import { mountChrome, requireAuth, currentProfile, $, $$, esc, readableError, toastOk } from './ui.js';
import { createRide } from './rides.js';
import { myActiveGroups } from './groups.js';
import { todayISO } from './format.js';
import { geocode } from './geocode.js';

await mountChrome();
if (!(await requireAuth())) throw new Error('redirecting');

const profile = await currentProfile(true);
const gate = $('#gate');
const form = $('#rideForm');

/* ---- Can this member post at all? The database enforces this too. -------- */
if (profile?.is_suspended) {
  gate.innerHTML = `<div class="alert alert-error">Your account is suspended, so you cannot post rides.</div>`;
} else if (profile?.is_minor) {
  const { myGuardians } = await import('./guardian.js');
  const links = await myGuardians();
  const active = links.some((l) => l.status === 'active');
  if (!active) {
    gate.innerHTML = `<div class="alert alert-warn">
      <strong>A parent or guardian must be linked first.</strong> Riders under 18 need an adult
      on the account before posting or joining rides.
      <a href="guardian.html">Get your linking code →</a></div>`;
  } else {
    gate.innerHTML = `<div class="safety-note mb-3">You're under 18, so your guardian can see the
      rides you post and the people who join them.</div>`;
    form.hidden = false;
  }
} else {
  form.hidden = false;
}

/* ---- Defaults ----------------------------------------------------------- */
$('#date').min = todayISO();
$('#date').value = todayISO();

$('#contribution').addEventListener('input', (e) => {
  const v = Number(e.target.value || 0);
  $('#contribHint').textContent = v > 0
    ? `Riders will see "$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)} contribution — paid directly to driver".`
    : 'Leave at 0 for no contribution.';
});

/* ---- Visibility --------------------------------------------------------- */
const groups = await myActiveGroups().catch(() => []);
$('#groupId').innerHTML = groups.length
  ? groups.map((g) => `<option value="${esc(g.group.id)}">${esc(g.group.name)}</option>`).join('')
  : '<option value="">You are not in any active group yet</option>';

function syncVisibility() {
  const picked = $$('input[name="visibility"]').find((i) => i.checked);
  $$('.radio-card').forEach((c) => c.classList.toggle('selected', c.contains(picked)));
  $('#groupField').hidden = picked.value !== 'group';
}
$$('input[name="visibility"]').forEach((i) => i.addEventListener('change', syncVisibility));
syncVisibility();

/* ---- Submit ------------------------------------------------------------- */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  const msg = $('#msg');
  msg.innerHTML = '';

  const visibility = $$('input[name="visibility"]').find((i) => i.checked).value;
  const groupId = $('#groupId').value;

  if (visibility === 'group' && !groupId) {
    msg.innerHTML = `<div class="alert alert-error">Choose a trusted group, or pick a different
      "who can join" option. <a href="groups.html">Join a group</a></div>`;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Locating…';

  // Turn the typed place names into coordinates so this ride can be found by a
  // mile radius. If the geocoder is down or the place is unrecognisable the
  // ride still posts — it just won't appear in radius-filtered results, and we
  // say so rather than failing silently.
  let originPos = null, destPos = null;
  try {
    originPos = await geocode($('#origin').value);
    destPos   = await geocode($('#destination').value);
  } catch { /* handled below by the null check */ }

  if (!originPos) {
    msg.innerHTML = `<div class="alert alert-warn">We could not pin
      "<strong>${esc($('#origin').value)}</strong>" on the map, so this ride will not show up
      when people filter by distance. It will still appear in normal search.
      Try adding a city and state, then post again — or press Post to continue anyway.</div>`;
  }

  btn.textContent = 'Posting ride…';
  try {
    const id = await createRide({
      originLat: originPos?.lat ?? null,
      originLng: originPos?.lng ?? null,
      destinationLat: destPos?.lat ?? null,
      destinationLng: destPos?.lng ?? null,
      origin: $('#origin').value,
      destination: $('#destination').value,
      date: $('#date').value,
      time: $('#time').value,
      seats: $('#seats').value,
      contribution: $('#contribution').value,
      notes: $('#notes').value,
      visibility,
      groupId: visibility === 'group' ? groupId : null,
      meetupPlace: $('#meetupPlace').value,
    });
    toastOk('Ride posted successfully!');
    location.href = `ride.html?id=${id}`;
  } catch (err) {
    msg.innerHTML = `<div class="alert alert-error">${esc(readableError(err))}</div>`;
    btn.disabled = false;
    btn.textContent = 'Post this ride';
  }
});
