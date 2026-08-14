import {
  mountChrome, requireAuth, currentProfile, $, $$, esc, rideCard, emptyState,
  avatarEl, seatBadge, toastOk, toastError, readableError, withBusy, confirmDialog,
  routeBlock, icon,
} from './ui.js';
import { myDrivingRides, myJoinedRides } from './rides.js';
import { myIncomingRequests, myOutgoingRequests, respondToRequest } from './requests.js';
import { GUARDIAN_STATUS_LABELS, REQUEST_STATUS_LABELS } from './constants.js';
import { whenLine, relativeTime } from './format.js';

await mountChrome({ active: 'Dashboard' });
$$('[data-ico]').forEach((el) => el.insertAdjacentHTML('afterbegin',
  icon(el.dataset.ico, el.classList.contains('feature-icon') ? 19 : 16)));
if (!(await requireAuth())) throw new Error('redirecting');

const panels = $('#panels');
const isUpcoming = (r) => r && r.status === 'upcoming' && new Date(r.depart_at) >= new Date(Date.now() - 3600e3);

async function load() {
  const profile = await currentProfile();
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (profile?.full_name || 'there').split(' ')[0];
  $('#welcome').innerHTML = `
    <h1 class="greeting">${esc(partOfDay)}, ${esc(firstName)}.</h1>
    <p class="lede mb-0">Here's what's happening with your rides.</p>`;

  $('#stats').innerHTML = '<div class="skeleton" style="height:92px"></div>'.repeat(4);
  panels.innerHTML = '<div class="skeleton" style="height:220px"></div>';

  let driving, joining, incoming, outgoing;
  try {
    [driving, joining, incoming, outgoing] = await Promise.all([
      myDrivingRides(), myJoinedRides(), myIncomingRequests(), myOutgoingRequests(),
    ]);
  } catch (err) {
    $('#stats').innerHTML = '';
    panels.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <h3 style="color:var(--ink)">Something went wrong. Please try again.</h3>
        <p style="max-width:46ch;margin-inline:auto">${esc(readableError(err))}</p>
        <button class="btn btn-primary mt-3" id="retry">Retry</button>
      </div>`;
    $('#retry').addEventListener('click', load);
    return;
  }

  const upcomingDriving = driving.filter(isUpcoming);
  const upcomingJoining = joining.filter((j) => isUpcoming(j.ride));
  const openSeats = upcomingDriving.reduce((n, r) => n + Number(r.seats_remaining || 0), 0);
  const pendingOut = outgoing.filter((r) => r.status === 'pending');

  /* --------------------------------------------------- your next ride -- */
  const soonest = [...upcomingDriving.map((r) => ({ ride: r, role: 'driving' })),
                   ...upcomingJoining.map((j) => ({ ride: j.ride, role: 'riding' }))]
    .sort((a, b) => new Date(a.ride.depart_at) - new Date(b.ride.depart_at))[0];

  $('#nextRide').innerHTML = soonest ? `
    <div class="next-ride">
      <div class="row-between" style="align-items:flex-start">
        <span class="label-quiet">Your next ride${soonest.role === 'driving' ? " — you're driving" : ''}</span>
        ${seatBadge(soonest.ride.seats_remaining)}
      </div>
      <div class="mt-3">${routeBlock(soonest.ride)}</div>
      <div class="row-between mt-4">
        <div>
          <div class="label-quiet">Departing</div>
          <div style="font-size:1.05rem;font-weight:580">${esc(whenLine(soonest.ride.depart_date, soonest.ride.depart_time))}</div>
        </div>
        <a class="btn btn-secondary" href="ride.html?id=${esc(soonest.ride.id)}&from=dashboard">View ride</a>
      </div>
    </div>` : `
    <div class="card card-pad-lg">
      <div class="row-between">
        <div>
          <span class="label-quiet">Your next ride</span>
          <h2 style="font-size:1.2rem;margin:.35rem 0 .25rem">Nothing booked yet</h2>
          <p class="muted small mb-0">Find someone already heading your way, or offer your own empty seats.</p>
        </div>
        <a class="btn btn-primary" href="find-ride.html">Find a Ride</a>
      </div>
    </div>`;

  /* ------------------------------------------------------------- stats -- */
  const tile = (label, value, note, href) => `
    <a class="card card-hover stat-card" href="${href}">
      <span class="label-quiet">${esc(label)}</span>
      <span class="stat-value">${esc(String(value))}</span>
      <span class="tiny muted">${esc(note)}</span>
    </a>`;

  $('#stats').innerHTML =
    tile('Upcoming', upcomingDriving.length + upcomingJoining.length,
         `${upcomingDriving.length} driving · ${upcomingJoining.length} riding`, 'my-rides.html') +
    tile("Seats you're offering", openSeats,
         openSeats ? 'still free on your rides' : 'no open seats right now', 'my-rides.html') +
    tile('Requests to you', incoming.length,
         incoming.length ? 'waiting on your decision' : 'nothing to review', 'my-rides.html?tab=requests') +
    tile('Your requests', pendingOut.length,
         pendingOut.length ? 'waiting on a driver' : 'none outstanding', 'my-rides.html?tab=sent');

  /* ------------------------------------------------------------ panels -- */
  const parts = [];

  // Driver's request queue — the thing most likely to need action.
  parts.push(`
    <section class="card mb-3">
      <div class="card-head"><h3>Join requests for your rides</h3>
        <span class="badge ${incoming.length ? 'badge-warn' : ''}">${incoming.length}</span></div>
      <div id="requestQueue">
        ${incoming.length
          ? incoming.map(requestRow).join('')
          : `<p class="small muted mb-0">No one is waiting on you.
             ${upcomingDriving.length ? 'Your posted rides are visible in Find a Ride.'
                                      : '<a href="post-ride.html">Post a ride</a> to start receiving requests.'}</p>`}
      </div>
    </section>`);

  parts.push(`
    <section class="mb-3">
      <div class="row-between mb-2"><h3 style="margin:0">Your upcoming rides</h3>
        <a class="small" href="my-rides.html">See all →</a></div>
      ${upcomingDriving.length || upcomingJoining.length ? `
        <div class="grid grid-3">
          ${upcomingDriving.slice(0, 3).map((r) => rideCard(r, {
            footer: `<a class="btn btn-secondary btn-sm" href="ride.html?id=${esc(r.id)}&from=dashboard">Manage</a>` })).join('')}
          ${upcomingJoining.slice(0, 3).map((j) => rideCard(j.ride, {
            footer: `<a class="btn btn-secondary btn-sm" href="ride.html?id=${esc(j.ride.id)}&from=dashboard">View ride</a>` })).join('')}
        </div>`
        : emptyState('🗓️', "You don't have any rides yet.",
            'Search for a trip going your way, or offer the empty seats on one you are already taking.',
            `<div class="row mt-3" style="justify-content:center">
               <a class="btn btn-primary" href="find-ride.html">Find a Ride</a>
               <a class="btn btn-secondary" href="post-ride.html">Post a Ride</a></div>`)}
    </section>`);

  if (pendingOut.length) {
    parts.push(`
      <section class="card">
        <div class="card-head"><h3>Requests you've sent</h3><span class="badge">${pendingOut.length}</span></div>
        ${pendingOut.map((r) => `
          <div class="row-between" style="padding:.6rem 0;border-bottom:1px solid var(--line)">
            <div>
              <div class="small strong">${esc(r.ride?.origin_label)} → ${esc(r.ride?.destination_label)}</div>
              <div class="tiny muted">${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}
                · sent ${esc(relativeTime(r.created_at))}</div>
            </div>
            <div class="row" style="gap:.4rem">
              <span class="badge badge-warn">${esc(REQUEST_STATUS_LABELS[r.status])}</span>
              <a class="btn btn-ghost btn-sm" href="ride.html?id=${esc(r.ride_id)}&from=dashboard">View</a>
            </div>
          </div>`).join('')}
      </section>`);
  }

  panels.innerHTML = parts.join('');
  wire();
}

function requestRow(r) {
  const p = r.rider || {};
  const full = Number(r.ride?.seats_remaining) <= 0;
  const waitingOnGuardian = r.guardian_status === 'pending';
  return `
    <div style="padding:.75rem 0;border-bottom:1px solid var(--line)">
      <div class="row-between" style="align-items:flex-start">
        <div class="row" style="gap:.6rem">
          ${avatarEl(p, '')}
          <div>
            <div class="strong small">${esc(p.full_name || 'Rider')}</div>
            <div class="tiny muted">
              ${p.rating_count ? `⭐ ${Number(p.rating_avg).toFixed(1)} (${p.rating_count})` : 'No ratings yet'}
              · wants ${r.seats_requested} seat${r.seats_requested === 1 ? '' : 's'}
              · ${esc(relativeTime(r.created_at))}</div>
          </div>
        </div>
        <a class="tiny" href="profile.html?id=${esc(r.rider_id)}">Profile</a>
      </div>
      <div class="small mt-1">
        <strong>${esc(r.ride?.origin_label)} → ${esc(r.ride?.destination_label)}</strong>
        <span class="muted">· ${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}</span>
      </div>
      <div class="ride-meta mt-1">
        ${seatBadge(r.ride?.seats_remaining)}
        ${r.guardian_status !== 'not_required'
          ? `<span class="badge ${r.guardian_status === 'approved' ? 'badge-ok' : 'badge-warn'}">${esc(GUARDIAN_STATUS_LABELS[r.guardian_status])}</span>`
          : ''}
      </div>
      ${r.message ? `<p class="tiny muted mt-1 mb-0" style="white-space:pre-wrap">"${esc(r.message)}"</p>` : ''}
      ${full ? '<div class="alert alert-warn mt-2 mb-0 small">This ride is full — free a seat before accepting.</div>' : ''}
      ${waitingOnGuardian ? '<div class="alert alert-info mt-2 mb-0 small">Waiting on this rider\'s parent or guardian.</div>' : ''}
      <div class="row mt-2">
        <button class="btn btn-ok btn-sm" data-accept="${esc(r.id)}" ${full || waitingOnGuardian ? 'disabled' : ''}>Accept</button>
        <button class="btn btn-secondary btn-sm" data-reject="${esc(r.id)}">Reject</button>
        <a class="btn btn-ghost btn-sm" href="ride.html?id=${esc(r.ride_id)}&from=dashboard">Open ride</a>
      </div>
    </div>`;
}

function wire() {
  $$('[data-accept]').forEach((b) => b.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Accepting…', async () => {
      try {
        await respondToRequest(e.currentTarget.dataset.accept, true);
        toastOk('Rider accepted — the seat count has gone down');
      } catch (err) { toastError(err); }
      await load();
    });
  }));

  $$('[data-reject]').forEach((b) => b.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Reject this request?',
      'They are notified and the seat stays open for someone else.', 'Reject'))) return;
    await withBusy(e.currentTarget, 'Rejecting…', async () => {
      try {
        await respondToRequest(e.currentTarget.dataset.reject, false);
        toastOk('Request rejected — the seat is still available');
      } catch (err) { toastError(err); }
      await load();
    });
  }));
}

load();
