import {
  mountChrome, requireAuth, $, $$, esc, rideCard, emptyState, avatarEl,
  toastOk, toastError, confirmDialog, seatBadge, withBusy, loadingState, errorState,
} from '../ui.js';
import { myDrivingRides, myJoinedRides, completeRide, cancelRide } from '../../../shared/rides.js';
import {
  myIncomingRequests, myOutgoingRequests, respondToRequest, cancelRequest,
} from '../../../shared/requests.js';
import { REQUEST_STATUS_LABELS, GUARDIAN_STATUS_LABELS } from '../../../shared/constants.js';
import { whenLine, relativeTime, money } from '../../../shared/format.js';

await mountChrome();
if (!(await requireAuth())) throw new Error('redirecting');

const panel = $('#panel');
let tab = new URLSearchParams(location.search).get('tab') || 'driving';

$$('.tab').forEach((t) => {
  t.classList.toggle('active', t.dataset.tab === tab);
  t.addEventListener('click', () => { tab = t.dataset.tab; sync(); });
});

function sync() {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
  history.replaceState(null, '', `?tab=${tab}`);
  render();
}

const isPast = (r) => r.status === 'completed' || r.status === 'cancelled' || new Date(r.depart_at) < new Date();

const LOADING_LABEL = {
  driving: 'Loading the rides you are driving…',
  joining: 'Loading the rides you have joined…',
  requests: 'Loading requests sent to you…',
  sent: 'Loading requests you have sent…',
};

async function render() {
  panel.innerHTML = loadingState(LOADING_LABEL[tab] || 'Loading…', 3);
  try {
    if (tab === 'driving')  return renderDriving();
    if (tab === 'joining')  return renderJoining();
    if (tab === 'requests') return renderIncoming();
    return renderOutgoing();
  } catch (err) {
    toastError(err);
    panel.innerHTML = errorState(err, 'retryMyRides');
    $('#retryMyRides').addEventListener('click', render);
  }
}

/* -------------------------------------------------------------- driving -- */
async function renderDriving() {
  const rides = await myDrivingRides();
  const upcoming = rides.filter((r) => !isPast(r));
  const past = rides.filter(isPast);

  if (!rides.length) {
    panel.innerHTML = emptyState('🚗', "You don't have any rides yet.",
      'Post a trip you were already taking and let people ask for the empty seats.',
      `<div class="row mt-3" style="justify-content:center">
         <a class="btn btn-primary" href="post-ride.html">Post a Ride</a>
         <a class="btn btn-secondary" href="find-ride.html">Find a Ride</a></div>`);
    return;
  }

  const card = (r) => rideCard(r, {
    footer: `<div class="row" style="gap:.4rem">
      <a class="btn btn-secondary btn-sm" href="ride.html?id=${esc(r.id)}&from=my-rides">Manage</a>
      ${r.status === 'upcoming' ? `
        <button class="btn btn-ok btn-sm" data-complete="${esc(r.id)}">Complete</button>
        <button class="btn btn-ghost btn-sm" data-cancel="${esc(r.id)}">Cancel</button>` : ''}
    </div>`,
  });

  panel.innerHTML = `
    <h3 class="mb-2">Upcoming <span class="badge">${upcoming.length}</span></h3>
    ${upcoming.length ? `<div class="grid grid-3 mb-4">${upcoming.map(card).join('')}</div>`
      : '<p class="muted small mb-3">Nothing coming up.</p>'}
    <h3 class="mb-2">Past <span class="badge">${past.length}</span></h3>
    ${past.length ? `<div class="grid grid-3">${past.map(card).join('')}</div>`
      : '<p class="muted small">No past rides yet.</p>'}`;

  $$('[data-complete]').forEach((b) => b.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Mark completed?', 'Riders can then rate you and you can rate them.', 'Mark completed'))) return;
    await withBusy(e.currentTarget, '…', async () => {
      try { await completeRide(e.currentTarget.dataset.complete); toastOk('Ride completed'); render(); }
      catch (err) { toastError(err); }
    });
  }));

  $$('[data-cancel]').forEach((b) => b.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Cancel this ride?', 'Everyone with a seat is notified immediately.', 'Cancel ride'))) return;
    await withBusy(e.currentTarget, '…', async () => {
      try { await cancelRide(e.currentTarget.dataset.cancel, 'Cancelled by driver'); toastOk('Ride cancelled'); render(); }
      catch (err) { toastError(err); }
    });
  }));
}

/* -------------------------------------------------------------- joining -- */
async function renderJoining() {
  const rows = await myJoinedRides();
  if (!rows.length) {
    panel.innerHTML = emptyState('🧍', "You haven't joined any rides yet.",
      'Search for a trip going your way and ask the driver for a seat.',
      `<div class="row mt-3" style="justify-content:center">
         <a class="btn btn-primary" href="find-ride.html">Find a Ride</a>
         <a class="btn btn-secondary" href="post-ride.html">Post a Ride</a></div>`);
    return;
  }
  const upcoming = rows.filter((r) => !isPast(r.ride));
  const past = rows.filter((r) => isPast(r.ride));

  const card = (row) => rideCard(row.ride, {
    footer: `<a class="btn btn-secondary btn-sm" href="ride.html?id=${esc(row.ride.id)}&from=my-rides">Ride details</a>`,
  });

  panel.innerHTML = `
    <h3 class="mb-2">Upcoming <span class="badge">${upcoming.length}</span></h3>
    ${upcoming.length ? `<div class="grid grid-3 mb-4">${upcoming.map(card).join('')}</div>`
      : '<p class="muted small mb-3">Nothing coming up.</p>'}
    <h3 class="mb-2">Past <span class="badge">${past.length}</span></h3>
    ${past.length ? `<div class="grid grid-3">${past.map(card).join('')}</div>`
      : '<p class="muted small">No past rides yet.</p>'}
    <div class="safety-note mt-3">Meetup points and phone numbers appear on each ride's detail page
    once your seat is confirmed.</div>`;
}

/* ------------------------------------------------------------- incoming -- */
async function renderIncoming() {
  const reqs = await myIncomingRequests();
  $('#reqCount').textContent = String(reqs.length);
  if (!reqs.length) {
    panel.innerHTML = emptyState('📭', 'No requests waiting',
      'When someone asks for a seat on one of your rides it shows up here.');
    return;
  }

  panel.innerHTML = `<div class="stack">${reqs.map((r) => {
    const p = r.rider || {};
    const full = Number(r.ride?.seats_remaining) <= 0;
    const blockedByGuardian = r.guardian_status === 'pending';
    return `
    <div class="card">
      <div class="row-between" style="align-items:flex-start">
        <div class="row" style="gap:.7rem">
          ${avatarEl(p, '')}
          <div>
            <div class="strong">${esc(p.full_name || 'Rider')}</div>
            <div class="tiny muted">${p.rating_count ? `${Number(p.rating_avg).toFixed(1)}★ (${p.rating_count})` : 'No ratings yet'}
              · ${p.rides_completed || 0} rides${p.is_minor ? ' · under 18' : ''} · asked ${esc(relativeTime(r.created_at))}</div>
          </div>
        </div>
        <a class="small" href="profile.html?id=${esc(r.rider_id)}">View profile</a>
      </div>

      <div class="mt-2 small">
        <strong>${esc(r.ride?.origin_label)} → ${esc(r.ride?.destination_label)}</strong>
        <span class="muted">· ${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}</span>
      </div>
      <div class="ride-meta mt-1">
        ${seatBadge(r.ride?.seats_remaining)}
        <span class="badge">Wants ${r.seats_requested} seat${r.seats_requested === 1 ? '' : 's'}</span>
        ${r.guardian_status !== 'not_required'
          ? `<span class="badge ${r.guardian_status === 'approved' ? 'badge-ok' : 'badge-warn'}">${esc(GUARDIAN_STATUS_LABELS[r.guardian_status])}</span>` : ''}
      </div>
      ${r.message ? `<p class="small muted mt-2 mb-0" style="white-space:pre-wrap">"${esc(r.message)}"</p>` : ''}
      ${full ? '<div class="alert alert-warn mt-2 mb-0 small">This ride is full — free a seat before accepting.</div>' : ''}
      ${blockedByGuardian ? '<div class="alert alert-info mt-2 mb-0 small">Waiting on this rider\'s parent or guardian. You cannot accept until they approve.</div>' : ''}
      <div class="row mt-2">
        <button class="btn btn-ok btn-sm" data-accept="${esc(r.id)}" ${full || blockedByGuardian ? 'disabled' : ''}>Accept</button>
        <button class="btn btn-secondary btn-sm" data-reject="${esc(r.id)}">Decline</button>
        <a class="btn btn-ghost btn-sm" href="ride.html?id=${esc(r.ride_id)}&from=my-rides">Open ride</a>
      </div>
    </div>`;
  }).join('')}</div>`;

  $$('[data-accept]').forEach((b) => b.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Accepting…', async () => {
      try { await respondToRequest(e.currentTarget.dataset.accept, true); toastOk('Accepted — seat count updated'); render(); }
      catch (err) { toastError(err); render(); }
    });
  }));
  $$('[data-reject]').forEach((b) => b.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Declining…', async () => {
      try { await respondToRequest(e.currentTarget.dataset.reject, false); toastOk('Declined'); render(); }
      catch (err) { toastError(err); }
    });
  }));
}

/* ------------------------------------------------------------- outgoing -- */
async function renderOutgoing() {
  const reqs = await myOutgoingRequests();
  if (!reqs.length) {
    panel.innerHTML = emptyState('✉️', 'You have not asked to join a ride yet',
      'Find a trip going your way and send the driver a request.',
      '<a class="btn btn-primary mt-3" href="find-ride.html">Find a Ride</a>');
    return;
  }
  const badgeCls = { pending: 'badge-warn', accepted: 'badge-ok', rejected: 'badge-danger', cancelled: '' };

  panel.innerHTML = `<div class="stack">${reqs.map((r) => `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="strong">${esc(r.ride?.origin_label)} → ${esc(r.ride?.destination_label)}</div>
          <div class="tiny muted">${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}
            · ${esc(money(r.ride?.contribution_amount))} · sent ${esc(relativeTime(r.created_at))}</div>
        </div>
        <span class="badge ${badgeCls[r.status] || ''}">${esc(REQUEST_STATUS_LABELS[r.status])}</span>
      </div>
      <div class="ride-meta mt-2">
        ${seatBadge(r.ride?.seats_remaining)}
        ${r.guardian_status !== 'not_required'
          ? `<span class="badge ${r.guardian_status === 'approved' ? 'badge-ok' : r.guardian_status === 'denied' ? 'badge-danger' : 'badge-warn'}">${esc(GUARDIAN_STATUS_LABELS[r.guardian_status])}</span>` : ''}
      </div>
      ${r.guardian_note ? `<p class="small muted mt-2 mb-0">Guardian note: ${esc(r.guardian_note)}</p>` : ''}
      <div class="row mt-2">
        <a class="btn btn-secondary btn-sm" href="ride.html?id=${esc(r.ride_id)}&from=my-rides">View ride</a>
        ${['pending', 'accepted'].includes(r.status)
          ? `<button class="btn btn-ghost btn-sm" data-withdraw="${esc(r.id)}">${r.status === 'accepted' ? 'Leave ride' : 'Withdraw'}</button>` : ''}
      </div>
    </div>`).join('')}</div>`;

  $$('[data-withdraw]').forEach((b) => b.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Are you sure?', 'If you had a seat it is released back to the driver.', 'Yes, withdraw'))) return;
    await withBusy(e.currentTarget, '…', async () => {
      try { await cancelRequest(e.currentTarget.dataset.withdraw); toastOk('Done'); render(); }
      catch (err) { toastError(err); }
    });
  }));
}

// keep the tab badge fresh even when another tab is open
myIncomingRequests().then((r) => { $('#reqCount').textContent = String(r.length); }).catch(() => {});
sync();
