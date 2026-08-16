import {
  mountChrome, requireAuth, currentProfile, $, $$, esc, qs, modal, confirmDialog,
  toastOk, toastError, readableError, seatBadge, avatarEl,
  visibilityBadge, emptyState, errorState, loadingState, backLink, withBusy,
  routeBlock,
} from './ui.js';
import {
  getRide, getParticipants, getRideMeetup, setRideMeetup, getRideContacts,
  cancelRide, completeRide, removeParticipant,
} from './rides.js';
import {
  requestToJoin, myRequestForRide, requestsForRide, cancelRequest, respondToRequest,
} from './requests.js';
import { blockUser, submitReport, rateUser, myRatingsGiven } from './safety.js';
import { myRideConversation } from './messages-api.js';
import {
  REPORT_CATEGORIES, REQUEST_STATUS_LABELS, GUARDIAN_STATUS_LABELS, RIDE_STATUS_LABELS,
} from './constants.js';
import { whenLine, contributionLine, initials } from './format.js';

await mountChrome();
const session = await requireAuth();
if (!session) throw new Error('redirecting');

const me = session.user.id;
const profile = await currentProfile();
const rideId = qs('id');
const page = $('#page');

if (!rideId) {
  page.innerHTML = emptyState('🤔', 'No ride selected', 'That link is missing a ride id.',
    '<a class="btn btn-primary mt-3" href="find-ride.html">Find a ride</a>');
  throw new Error('no id');
}

/**
 * Where "back" goes depends on how you arrived: drivers come from their own
 * lists, riders come from search. `?from=` lets the linking page be explicit.
 */
function backTarget(isDriver) {
  const from = qs('from');
  if (from === 'my-rides')  return ['my-rides.html', 'Back to My Rides'];
  if (from === 'dashboard') return ['dashboard.html', 'Back to Dashboard'];
  if (from === 'find')      return ['find-ride.html', 'Back to Find a Ride'];
  return isDriver ? ['my-rides.html', 'Back to My Rides'] : ['find-ride.html', 'Back to Find a Ride'];
}

async function load() {
  page.innerHTML = loadingState('Loading ride details…') + '<div class="skeleton" style="height:260px"></div>';

  let ride;
  try {
    ride = await getRide(rideId);
  } catch (err) {
    page.innerHTML = errorState(err, 'retryRide');
    $('#retryRide').addEventListener('click', load);
    return;
  }
  if (!ride) {
    page.innerHTML = emptyState('🚫', 'Ride not available',
      'This ride was removed, cancelled, or is limited to a trusted group you are not in.',
      '<a class="btn btn-primary mt-3" href="find-ride.html">Browse other rides</a>');
    return;
  }

  const isDriver = ride.driver_id === me;
  const [participants, myReq] = await Promise.all([
    getParticipants(rideId).catch(() => []),
    myRequestForRide(rideId).catch(() => null),
  ]);
  const amAccepted = participants.some((p) => p.user_id === me);
  const meetup = (isDriver || amAccepted) ? await getRideMeetup(rideId).catch(() => null) : null;
  const pending = isDriver ? await requestsForRide(rideId, 'pending').catch(() => []) : [];

  page.innerHTML = `
    ${backLink(...backTarget(isDriver))}
    <div class="ride-layout" id="layout">
      <div class="stack" id="main"></div>
      <div class="stack" id="side"></div>
    </div>`;

  renderMain(ride, { isDriver, amAccepted, myReq, meetup, participants });
  renderSide(ride, { isDriver, amAccepted, myReq, participants, pending });
}

/* ------------------------------------------------------------------ main -- */
function renderMain(ride, ctx) {
  const { isDriver, amAccepted, meetup } = ctx;
  const d = ride.driver || {};

  $('#main').innerHTML = `
    <section class="ride-hero">
      <div class="row-between" style="align-items:flex-start">
        <span class="label-quiet">${esc(whenLine(ride.depart_date, ride.depart_time))}</span>
        ${ride.status !== 'upcoming'
          ? `<span class="badge badge-warn">${esc(RIDE_STATUS_LABELS[ride.status] || ride.status)}</span>` : ''}
      </div>
      <div class="mt-3">${routeBlock(ride, {
        subFrom: ride.origin_area || '', subTo: ride.destination_area || '' })}</div>
      <div class="ride-meta">
        ${seatBadge(ride.seats_remaining)}
        ${visibilityBadge(ride)}
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Your driver</h3>
        ${!isDriver ? '<button class="btn btn-ghost btn-sm" id="reportDriver">Report or block</button>' : ''}</div>
      <div class="person-row">
        ${avatarEl(d, 'avatar-lg')}
        <div style="min-width:0">
          <div class="person-name">${esc(d.full_name || 'Driver')}</div>
          <div class="row mt-1" style="gap:8px">
            ${d.rating_count
              ? `<span><span class="stars">★</span> <span class="rating-num">${Number(d.rating_avg).toFixed(1)}</span>
                 <span class="muted small">(${d.rating_count})</span></span>`
              : '<span class="muted small">New member</span>'}
          </div>
          <div class="tiny muted mt-1">${d.rides_completed || 0} completed ride${d.rides_completed === 1 ? '' : 's'}</div>
          <a class="small" href="profile.html?id=${esc(ride.driver_id)}">View full profile</a>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head"><h3>Ride details</h3></div>
      <div class="detail-list">
        <div class="detail-row"><span class="detail-key">Seats</span>
          <span class="detail-val">${ride.seats_taken} of ${ride.seats_offered} taken · ${ride.seats_remaining} free</span></div>
        <div class="detail-row"><span class="detail-key">Contribution</span>
          <span class="detail-val">${esc(contributionLine(ride.contribution_amount))}</span></div>
        <div class="detail-row"><span class="detail-key">Who can join</span>
          <span class="detail-val">${ride.visibility === 'group'
            ? esc(ride.group?.name || 'A trusted group')
            : ride.visibility === 'approval' ? 'People the driver invites' : 'Anyone on CarBuddy'}</span></div>
        ${ride.cancelled_reason ? `<div class="detail-row"><span class="detail-key">Cancelled because</span>
          <span class="detail-val">${esc(ride.cancelled_reason)}</span></div>` : ''}
      </div>
      ${Number(ride.contribution_amount) > 0 ? `
        <div class="safety-note mt-3">
          The contribution is arranged directly between you and your driver, in person.
          CarBuddy never processes, holds, or guarantees money — never send anything in advance.
        </div>` : ''}
      ${ride.notes ? `<div class="mt-3">
        <div class="label">Notes from your driver</div>
        <p class="mb-0" style="white-space:pre-wrap;color:var(--ink-2)">${esc(ride.notes)}</p></div>` : ''}
    </section>

    ${(isDriver || amAccepted) ? `
    <section class="card" id="contactCard">
      <div class="card-head"><h3>${isDriver ? 'Your riders' : 'Your driver'}</h3>
        <span class="badge badge-ok">Seat confirmed</span></div>
      <div id="contactList">${loadingState('Loading contact details…', 0)}</div>
      <a class="btn btn-primary btn-block mt-3 hidden" id="messageBtn" href="#">
        ${isDriver ? 'Message riders' : 'Message driver'}</a>
    </section>

    <section class="card">
      <div class="card-head"><h3>Meetup</h3>
        ${isDriver ? '<button class="btn btn-secondary btn-sm" id="editMeetup">Edit</button>' : ''}</div>
      ${meetup?.meetup_place || meetup?.meetup_notes ? `
        <div class="detail-list">
          ${meetup.meetup_place ? `<div class="detail-row"><span class="detail-key">Meet at</span>
            <span class="detail-val">${esc(meetup.meetup_place)}</span></div>` : ''}
          ${meetup.meetup_notes ? `<div class="detail-row"><span class="detail-key">Notes</span>
            <span class="detail-val" style="white-space:pre-wrap">${esc(meetup.meetup_notes)}</span></div>` : ''}
        </div>` : `<p class="muted small mb-0">No meetup point yet${isDriver ? ' — add one so riders know where to go.' : '. Ask your driver to add one.'}</p>`}
      <div class="safety-note mt-3">Meet somewhere public and well lit, and tell someone you trust
      where you're going and who you're travelling with.</div>
    </section>` : ''}`;

  $('#editMeetup')?.addEventListener('click', () => editMeetupDialog(ride, meetup));
  if (ctx.isDriver || ctx.amAccepted) {
    loadContacts(ride.id, ctx.isDriver);
    // The conversation is created by the server when a rider is accepted; this
    // only finds the existing one, so opening a ride never makes a duplicate.
    myRideConversation(ride.id).then((cid) => {
      const btn = $('#messageBtn');
      if (btn && cid) { btn.href = `messages.html?c=${cid}`; btn.classList.remove('hidden'); }
    }).catch(() => { /* button simply stays hidden */ });
  }
  $('#reportDriver')?.addEventListener('click', () => reportDialog(ride, d));
}

/* ------------------------------------------------------------------ side -- */
function renderSide(ride, ctx) {
  const { isDriver, amAccepted, myReq, participants, pending } = ctx;
  const full = Number(ride.seats_remaining) <= 0;
  const closed = ride.status !== 'upcoming';
  const parts = [];

  /* ---- action box ---- */
  if (isDriver) {
    parts.push(`
      <section class="card">
        <div class="card-head"><h3>You're driving</h3></div>
        <div class="stack-sm">
          <a class="btn btn-secondary btn-block" href="my-rides.html">Manage in My Rides</a>
          <button class="btn btn-secondary btn-block" id="shareBtn">Copy ride link</button>
          ${ride.status === 'upcoming' ? `
            <button class="btn btn-ok btn-block" id="completeBtn">Mark ride completed</button>
            <button class="btn btn-danger btn-block" id="cancelRideBtn">Cancel this ride</button>` : ''}
        </div>
      </section>`);
  } else if (closed) {
    parts.push(`<section class="card"><div class="alert alert-warn mb-0">
      ${ride.status === 'active'
        ? 'This ride has reached its departure time, so the listing has closed and it is no longer accepting riders.'
        : ride.status === 'completed'
          ? 'This ride is finished. You can leave a rating for the people you travelled with.'
          : 'This ride was cancelled and is no longer accepting riders.'}</div></section>`);
  } else if (myReq && myReq.status === 'pending') {
    parts.push(`
      <section class="card">
        <div class="card-head"><h3>Request sent</h3></div>
        <p class="small muted">Waiting for ${esc(ride.driver?.full_name || 'your driver')} to respond.
        ${myReq.guardian_status === 'pending' ? 'Your guardian also needs to approve this ride.' : ''}</p>
        <div class="ride-meta mb-2">
          <span class="badge badge-warn">${esc(REQUEST_STATUS_LABELS[myReq.status])}</span>
          ${myReq.guardian_status !== 'not_required'
            ? `<span class="badge ${myReq.guardian_status === 'approved' ? 'badge-ok' : 'badge-warn'}">${esc(GUARDIAN_STATUS_LABELS[myReq.guardian_status])}</span>` : ''}
        </div>
        <button class="btn btn-secondary btn-block" id="withdrawBtn">Withdraw request</button>
      </section>`);
  } else if (amAccepted) {
    parts.push(`
      <section class="card">
        <div class="alert alert-ok"><strong>Your seat is confirmed.</strong></div>
        <p class="small muted">The meetup point and contact details are on the left.</p>
        <button class="btn btn-secondary btn-block" id="leaveBtn">Leave this ride</button>
      </section>`);
  } else if (myReq && myReq.status === 'rejected') {
    parts.push(`
      <section class="card">
        <div class="alert alert-warn mb-2">Your driver couldn't take this one.</div>
        <p class="small muted mb-0">The seat may still be open for others. You can look for another ride.</p>
        <a class="btn btn-primary btn-block mt-2" href="find-ride.html">Find another ride</a>
      </section>`);
  } else {
    const blocked = full;
    parts.push(`
      <section class="card">
        <div class="card-head"><h3>${blocked ? 'This ride is full' : 'Request a seat'}</h3></div>
        <div class="mb-2">${seatBadge(ride.seats_remaining)}</div>
        ${blocked
          ? `<p class="small muted">Every seat is taken, so requests are closed for now.</p>
             <a class="btn btn-secondary btn-block" href="find-ride.html">Find another ride</a>`
          : `<label class="field"><span>Seats you need</span>
              <select id="seatsWanted">${
                Array.from({ length: Math.min(4, ride.seats_remaining) }, (_, i) =>
                  `<option value="${i + 1}">${i + 1} seat${i ? 's' : ''}</option>`).join('')
              }</select></label>
             <label class="field"><span>Say hello <span class="muted">(optional)</span></span>
              <textarea id="joinMessage" maxlength="500" style="min-height:74px"
                placeholder="Hi! I'm on the robotics team too — happy to meet at the library."></textarea></label>
             <button class="btn btn-primary btn-block btn-lg" id="requestBtn">Request a seat</button>
             <p class="tiny muted mt-2 mb-0">Nothing is booked yet. Your driver reviews your profile
             and decides.${profile?.is_minor ? ' Your parent or guardian approves it too.' : ''}</p>`}
      </section>`);
  }

  /* ---- pending requests, driver only ---- */
  if (isDriver) {
    parts.push(`
      <section class="card">
        <div class="card-head"><h3>Seat requests</h3>
          <span class="badge ${pending.length ? 'badge-warn' : ''}">${pending.length} pending</span></div>
        <div id="pendingList">${pending.length ? pending.map(pendingRow).join('') : '<p class="small muted mb-0">Nobody is waiting on you right now.</p>'}</div>
        ${full && pending.length ? `<div class="alert alert-warn mt-2 mb-0 small">
          Your ride is full, so you cannot accept anyone else until a seat opens up.</div>` : ''}
      </section>`);
  }

  /* ---- who's on board ---- */
  parts.push(`
    <section class="card">
      <div class="card-head"><h3>Riding along</h3><span class="badge">${participants.length}</span></div>
      ${participants.length ? participants.map((p) => `
        <div class="row-between" class="list-row">
          <div class="row" style="gap:.5rem">
            ${avatarEl(p.profile, 'avatar-sm')}
            <div><div class="small strong">${esc(p.profile?.full_name || 'Rider')}</div>
            <div class="tiny muted">${p.seats} seat${p.seats === 1 ? '' : 's'}${p.profile?.is_minor ? ' · under 18' : ''}</div></div>
          </div>
          ${isDriver ? `<button class="btn btn-ghost btn-sm" data-remove="${esc(p.user_id)}">Remove</button>` : ''}
        </div>`).join('')
        : '<p class="small muted mb-0">No one has joined yet.</p>'}
    </section>`);

  /* ---- ratings after completion ---- */
  if (ride.status === 'completed' && (isDriver || amAccepted)) {
    parts.push(`<section class="card">
      <div class="card-head"><h3>Rate this ride</h3></div>
      <div id="rateBox"><p class="small muted mb-0">Loading…</p></div></section>`);
  }

  $('#side').innerHTML = parts.join('');
  wireSide(ride, ctx);
}

function pendingRow(r) {
  const p = r.rider || {};
  return `
    <div class="list-row">
      <div class="row" style="gap:.5rem">
        ${avatarEl(p, 'avatar-sm')}
        <div style="min-width:0;flex:1">
          <div class="small strong">${esc(p.full_name || 'Rider')}</div>
          <div class="tiny muted">${p.rating_count ? `${Number(p.rating_avg).toFixed(1)}★ (${p.rating_count})` : 'No ratings yet'}
            · ${r.seats_requested} seat${r.seats_requested === 1 ? '' : 's'}${p.is_minor ? ' · under 18' : ''}</div>
        </div>
      </div>
      ${r.message ? `<p class="tiny muted mt-1 mb-1" style="white-space:pre-wrap">"${esc(r.message)}"</p>` : ''}
      ${r.guardian_status === 'pending'
        ? '<div class="badge badge-warn" style="margin:.3rem 0">Waiting on guardian approval</div>' : ''}
      ${r.guardian_status === 'approved'
        ? '<div class="badge badge-ok" style="margin:.3rem 0">Guardian approved</div>' : ''}
      <div class="row mt-1">
        <button class="btn btn-ok btn-sm" data-accept="${esc(r.id)}"
          ${r.guardian_status === 'pending' ? 'disabled title="This rider needs guardian approval first"' : ''}>Accept</button>
        <button class="btn btn-secondary btn-sm" data-reject="${esc(r.id)}">Decline</button>
      </div>
    </div>`;
}

/* --------------------------------------------------------------- wiring --- */
function wireSide(ride, ctx) {
  $('#requestBtn')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Sending request…', async () => {
      try {
        await requestToJoin(ride.id, {
          message: $('#joinMessage').value,
          seats: Number($('#seatsWanted').value),
        });
        toastOk('Request sent. Your driver will review your request.');
        load();
      } catch (err) { toastError(err); }
    });
  });

  $('#withdrawBtn')?.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Withdraw request?', 'The driver will no longer see your request.', 'Withdraw'))) return;
    await withBusy(e.currentTarget, 'Withdrawing…', async () => {
      try { await cancelRequest(ctx.myReq.id); toastOk('Request withdrawn'); load(); }
      catch (err) { toastError(err); }
    });
  });

  $('#leaveBtn')?.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Leave this ride?', 'Your seat is released back to the driver straight away.', 'Leave ride'))) return;
    await withBusy(e.currentTarget, 'Leaving…', async () => {
      try {
        const req = ctx.myReq || await myRequestForRide(ride.id);
        if (req) await cancelRequest(req.id);
        toastOk('You left the ride');
        load();
      } catch (err) { toastError(err); }
    });
  });

  $('#shareBtn')?.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}?id=${ride.id}`;
    try { await navigator.clipboard.writeText(url); toastOk('Link copied'); }
    catch { modal({ title: 'Ride link', body: `<input type="text" readonly value="${esc(url)}">`, actions: [{ label: 'Close', onClick: (_, c) => c() }] }); }
  });

  $('#cancelRideBtn')?.addEventListener('click', () => cancelRideDialog(ride));

  $('#completeBtn')?.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Mark as completed?',
      'Everyone on board can then rate each other, and the ride moves to your history.', 'Mark completed'))) return;
    await withBusy(e.currentTarget, 'Saving…', async () => {
      try { await completeRide(ride.id); toastOk('Ride completed'); load(); }
      catch (err) { toastError(err); }
    });
  });

  $$('[data-accept]').forEach((b) => b.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Accepting…', async () => {
      try { await respondToRequest(e.currentTarget.dataset.accept, true); toastOk('Rider accepted — seat count updated'); load(); }
      catch (err) { toastError(err); load(); }
    });
  }));

  $$('[data-reject]').forEach((b) => b.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Declining…', async () => {
      try { await respondToRequest(e.currentTarget.dataset.reject, false); toastOk('Request declined'); load(); }
      catch (err) { toastError(err); }
    });
  }));

  $$('[data-remove]').forEach((b) => b.addEventListener('click', async (e) => {
    const userId = e.currentTarget.dataset.remove;
    if (!(await confirmDialog('Remove this rider?', 'Their seat becomes available again and they are notified.', 'Remove'))) return;
    try { await removeParticipant(ride.id, userId); toastOk('Rider removed'); load(); }
    catch (err) { toastError(err); }
  }));

  if (ride.status === 'completed' && (ctx.isDriver || ctx.amAccepted)) renderRateBox(ride, ctx);
}

/* -------------------------------------------------------------- dialogs --- */
function editMeetupDialog(ride, meetup) {
  modal({
    title: 'Meetup details',
    body: `
      <label class="field"><span>Meet at</span>
        <input type="text" id="mPlace" maxlength="160" value="${esc(meetup?.meetup_place || '')}"
          placeholder="Front parking lot, Frisco Public Library"></label>
      <label class="field"><span>Notes</span>
        <textarea id="mNotes" maxlength="500" placeholder="I'll be in a grey Civic. Text when you arrive.">${esc(meetup?.meetup_notes || '')}</textarea></label>
      <div class="safety-note">Only confirmed riders and their guardians can read this.
      Use a public place — never a home address.</div>`,
    actions: [
      { label: 'Cancel', onClick: (_, close) => close() },
      { label: 'Save', cls: 'btn-primary', onClick: async (root, close) => {
          await setRideMeetup(ride.id, {
            meetup_place: root.querySelector('#mPlace').value.trim() || null,
            meetup_notes: root.querySelector('#mNotes').value.trim() || null,
          });
          close(); toastOk('Meetup details saved'); load();
        } },
    ],
  });
}

function cancelRideDialog(ride) {
  modal({
    title: 'Cancel this ride?',
    body: `<p class="muted small">Everyone who has a seat is notified straight away. This cannot be undone.</p>
      <label class="field"><span>Reason (shared with riders)</span>
        <input type="text" id="reason" maxlength="200" placeholder="Plans changed — sorry!"></label>`,
    actions: [
      { label: 'Keep the ride', onClick: (_, close) => close() },
      { label: 'Cancel ride', cls: 'btn-danger', onClick: async (root, close) => {
          await cancelRide(ride.id, root.querySelector('#reason').value);
          close(); toastOk('Ride cancelled'); load();
        } },
    ],
  });
}

/**
 * Phone numbers, shown only after the driver accepts. The database refuses this
 * call for anyone whose seat is not confirmed, so this is a presentation layer
 * over a real permission — not a hidden field.
 */
async function loadContacts(rideId, isDriver) {
  const host = $('#contactList');
  if (!host) return;
  try {
    const rows = await getRideContacts(rideId);
    const others = rows.filter((r) => r.user_id !== me);

    host.innerHTML = others.length ? `
      ${others.map((r) => `
        <div class="list-row">
          <div class="row" style="gap:10px;min-width:0">
            <span class="avatar avatar-sm">${esc(initials(r.full_name))}</span>
            <div style="min-width:0">
              <div class="small strong">${esc(r.full_name)}</div>
              <div class="tiny muted">${r.role === 'driver' ? 'Your driver' : 'Riding with you'}</div>
            </div>
          </div>
          ${r.phone
            ? `<div class="row" style="gap:6px">
                 <a class="btn btn-secondary btn-sm" href="tel:${esc(r.phone)}">${esc(r.phone)}</a>
                 <a class="btn btn-ghost btn-sm" href="sms:${esc(r.phone)}">Text</a>
               </div>`
            : '<span class="tiny muted">No number saved</span>'}
        </div>`).join('')}
      <p class="tiny muted mt-3 mb-0">${isDriver
        ? 'You can see your riders because you accepted them. They can see your number, but not each other\'s.'
        : 'You can see this because your seat is confirmed. Please keep it between you.'}</p>`
      : '<p class="small muted mb-0">Nobody else is on this ride yet.</p>';
  } catch (err) {
    host.innerHTML = `<div class="alert alert-warn mb-0">${esc(readableError(err))}</div>`;
  }
}

function reportDialog(ride, driver) {
  modal({
    title: `Report or block ${driver.full_name || 'this driver'}`,
    body: `
      <label class="field"><span>What happened?</span>
        <select id="rCat">${REPORT_CATEGORIES.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Details</span>
        <textarea id="rDetails" maxlength="2000" placeholder="Tell us what happened, with dates and times if you can."></textarea></label>
      <label class="check"><input type="checkbox" id="alsoBlock">
        <span>Also block this person — you will disappear from each other's search results.</span></label>
      <p class="tiny muted mb-0">If someone is in immediate danger, contact your local emergency
      services first. Reports go to our moderation queue.</p>`,
    actions: [
      { label: 'Cancel', onClick: (_, close) => close() },
      { label: 'Submit report', cls: 'btn-danger', onClick: async (root, close) => {
          const details = root.querySelector('#rDetails').value.trim();
          if (details.length < 5) { toastError('Please add a few words of detail.'); return; }
          await submitReport({
            reportedUserId: ride.driver_id, rideId: ride.id,
            category: root.querySelector('#rCat').value, details,
          });
          if (root.querySelector('#alsoBlock').checked) await blockUser(ride.driver_id, 'Reported');
          close(); toastOk('Report submitted — thank you');
        } },
    ],
  });
}

/* --------------------------------------------------------------- ratings -- */
async function renderRateBox(ride, ctx) {
  const box = $('#rateBox');
  if (!box) return;
  const [given, participants] = await Promise.all([
    myRatingsGiven(ride.id).catch(() => []),
    getParticipants(ride.id).catch(() => []),
  ]);
  const done = new Set(given.map((g) => g.ratee_id));

  const people = [];
  if (!ctx.isDriver) people.push({ id: ride.driver_id, name: ride.driver?.full_name, role: 'Driver' });
  participants.filter((p) => p.user_id !== me)
    .forEach((p) => people.push({ id: p.user_id, name: p.profile?.full_name, role: 'Rider' }));

  if (!people.length) { box.innerHTML = '<p class="small muted mb-0">Nobody else to rate on this ride.</p>'; return; }

  box.innerHTML = people.map((p) => `
    <div class="list-row">
      <div class="row-between">
        <div><span class="small strong">${esc(p.name || 'Member')}</span>
          <span class="badge">${esc(p.role)}</span></div>
        ${done.has(p.id) ? '<span class="badge badge-ok">Rated</span>' : ''}
      </div>
      ${done.has(p.id) ? '' : `
        <div class="row mt-1" data-rate-for="${esc(p.id)}">
          ${[1, 2, 3, 4, 5].map((n) => `<button class="btn btn-secondary btn-sm" data-stars="${n}">${n}★</button>`).join('')}
        </div>`}
    </div>`).join('');

  $$('[data-rate-for]').forEach((row) => {
    row.querySelectorAll('[data-stars]').forEach((btn) => btn.addEventListener('click', async () => {
      const rateeId = row.dataset.rateFor;
      const stars = Number(btn.dataset.stars);
      modal({
        title: `Rate ${stars} star${stars === 1 ? '' : 's'}`,
        body: `<label class="field"><span>Anything to add? (optional)</span>
          <textarea id="rc" maxlength="400" placeholder="On time, easy to find, friendly."></textarea></label>`,
        actions: [
          { label: 'Cancel', onClick: (_, c) => c() },
          { label: 'Submit rating', cls: 'btn-primary', onClick: async (root, close) => {
              try {
                await rateUser(ride.id, rateeId, stars, root.querySelector('#rc').value);
                close(); toastOk('Thanks for the rating'); renderRateBox(ride, ctx);
              } catch (err) { toastError(err); }
            } },
        ],
      });
    }));
  });
}

load();
