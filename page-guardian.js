import {
  mountChrome, requireAuth, currentProfile, $, $$, esc, modal, confirmDialog,
  toastOk, toastError, avatarEl, withBusy, loadingState, errorState,
} from './ui.js';
import {
  createGuardianInvite, claimGuardianInvite, revokeGuardianLink,
  myDependents, myGuardians, dependentRequests, decideRequest, dependentRideMeetup,
} from './guardian.js';
import { GUARDIAN_STATUS_LABELS, REQUEST_STATUS_LABELS } from './constants.js';
import { whenLine, relativeTime, money, starString } from './format.js';

await mountChrome();
if (!(await requireAuth())) throw new Error('redirecting');

const profile = await currentProfile(true);
const page = $('#page');

async function render() {
  page.innerHTML = loadingState('Loading guardian dashboard…', 0) + '<div class="skeleton" style="height:200px"></div>';
  let dependents, guardians, requests;
  try {
    [dependents, guardians] = await Promise.all([myDependents(), myGuardians()]);
    requests = dependents.length ? await dependentRequests() : [];
  } catch (err) {
    page.innerHTML = errorState(err, 'retryGuardian');
    $('#retryGuardian').addEventListener('click', render);
    return;
  }
  const pending = requests.filter((r) => r.guardian_status === 'pending');
  const approvedUpcoming = requests.filter(
    (r) => r.guardian_status === 'approved' && r.ride && r.ride.status === 'upcoming');

  const blocks = [];

  /* ---- young rider's own view ---- */
  if (profile?.is_minor) blocks.push(minorSection(guardians));

  /* ---- adult view ---- */
  blocks.push(`
    <section class="card mb-3">
      <div class="card-head"><h3>Riders I'm responsible for</h3>
        <button class="btn btn-primary btn-sm" id="linkBtn">Link a rider</button></div>
      ${dependents.length ? dependents.map((d) => `
        <div class="row-between" style="padding:.6rem 0;border-bottom:1px solid var(--line)">
          <div class="row" style="gap:.6rem">
            ${avatarEl(d.minor, '')}
            <div><div class="strong">${esc(d.minor?.full_name || 'Rider')}</div>
              <div class="tiny muted">${esc(d.relationship || 'Guardian')} · linked ${esc(relativeTime(d.linked_at || d.created_at))}
                · ${d.minor?.rides_completed || 0} completed rides</div></div>
          </div>
          <div class="row" style="gap:.4rem">
            <a class="btn btn-ghost btn-sm" href="profile.html?id=${esc(d.minor?.id)}">Profile</a>
            <button class="btn btn-ghost btn-sm" data-revoke="${esc(d.id)}">Unlink</button>
          </div>
        </div>`).join('')
        : `<p class="small muted mb-0">No riders linked yet. Ask them to open this page on their own
           account and read you their code, then press <strong>Link a rider</strong>.</p>`}
    </section>`);

  if (dependents.length) {
    blocks.push(`
      <section class="card mb-3">
        <div class="card-head"><h3>Waiting for your approval</h3>
          <span class="badge ${pending.length ? 'badge-warn' : ''}">${pending.length}</span></div>
        ${pending.length ? pending.map(requestCard).join('')
          : '<p class="small muted mb-0">Nothing needs a decision right now.</p>'}
      </section>

      <section class="card mb-3">
        <div class="card-head"><h3>Approved upcoming rides</h3><span class="badge">${approvedUpcoming.length}</span></div>
        ${approvedUpcoming.length ? approvedUpcoming.map(approvedCard).join('')
          : '<p class="small muted mb-0">No approved rides coming up.</p>'}
      </section>

      <section class="card">
        <div class="card-head"><h3>Full history</h3></div>
        ${requests.length ? `<div class="table-wrap"><table class="data"><thead><tr>
            <th>Rider</th><th>Route</th><th>When</th><th>Your decision</th><th>Ride status</th></tr></thead><tbody>
            ${requests.map((r) => `<tr>
              <td>${esc(r.rider?.full_name || '')}</td>
              <td>${esc(r.ride?.origin_label || '')} → ${esc(r.ride?.destination_label || '')}</td>
              <td>${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}</td>
              <td><span class="badge ${r.guardian_status === 'approved' ? 'badge-ok' : r.guardian_status === 'denied' ? 'badge-danger' : 'badge-warn'}">${esc(GUARDIAN_STATUS_LABELS[r.guardian_status])}</span></td>
              <td><span class="badge">${esc(REQUEST_STATUS_LABELS[r.status])}</span></td></tr>`).join('')}
          </tbody></table></div>`
          : '<p class="small muted mb-0">No ride history yet.</p>'}
      </section>`);
  }

  blocks.push(`
    <div class="safety-note mt-3">
      <strong>How this works.</strong> A rider under 18 cannot join or post any ride until an adult is
      linked here. Once linked, every request they send waits for your approval — the driver's Accept
      button stays disabled until you decide. The rider cannot unlink you; only you or an administrator can.
      Notifications for each request are already stored server-side, so the mobile app will be able to
      push them to your phone without any backend changes.
    </div>`);

  page.innerHTML = blocks.join('');
  wire();
}

function minorSection(guardians) {
  const active = guardians.find((g) => g.status === 'active');
  return `
    <section class="card mb-3">
      <div class="card-head"><h3>Your guardian</h3>
        ${active ? '<span class="badge badge-ok">Linked</span>' : '<span class="badge badge-warn">Not linked yet</span>'}</div>
      ${active ? `
        <div class="row" style="gap:.6rem">${avatarEl(active.guardian, '')}
          <div><div class="strong">${esc(active.guardian?.full_name || 'Guardian')}</div>
            <div class="tiny muted">${esc(active.relationship || 'Parent/Guardian')} · they approve each ride you join</div></div></div>`
        : `<p class="small muted">You need a parent or guardian on your account before you can join or
           post any ride. Press the button below, then read the code to them — they enter it on this
           same page from their own CarBuddy account.</p>
           <button class="btn btn-primary" id="inviteBtn">Get my linking code</button>
           <div id="inviteOut" class="mt-2"></div>`}
    </section>`;
}

function requestCard(r) {
  const d = r.ride?.driver || {};
  return `
  <div class="card mb-2" style="box-shadow:none;border-color:var(--line-2)">
    <div class="row-between" style="align-items:flex-start">
      <div><div class="strong">${esc(r.rider?.full_name || 'Rider')} wants to join a ride</div>
        <div class="tiny muted">Asked ${esc(relativeTime(r.created_at))}</div></div>
      <span class="badge badge-warn">Needs your decision</span>
    </div>
    <hr class="divider">
    <dl class="kv">
      <dt>Route</dt><dd>${esc(r.ride?.origin_label)} → ${esc(r.ride?.destination_label)}</dd>
      <dt>When</dt><dd>${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}</dd>
      <dt>Driver</dt><dd>${esc(d.full_name || 'Driver')}
        ${d.verification_status === 'verified' ? '<span class="badge badge-ok">✓ Verified</span>' : '<span class="badge badge-warn">Unverified</span>'}</dd>
      <dt>Driver rating</dt><dd>${d.rating_count
        ? `<span class="stars">${starString(d.rating_avg)}</span> ${Number(d.rating_avg).toFixed(1)} (${d.rating_count}) · ${d.rides_completed || 0} rides`
        : 'No ratings yet'}</dd>
      <dt>Contribution</dt><dd>${esc(money(r.ride?.contribution_amount))}${Number(r.ride?.contribution_amount) > 0 ? ' — paid in person' : ''}</dd>
      <dt>Seats</dt><dd>${r.seats_requested} requested · ${esc(String(r.ride?.seats_remaining))} remaining</dd>
    </dl>
    ${r.message ? `<p class="small muted mt-2 mb-0">Their message: "${esc(r.message)}"</p>` : ''}
    <div class="row mt-2">
      <button class="btn btn-ok btn-sm" data-approve="${esc(r.id)}">Approve this ride</button>
      <button class="btn btn-danger btn-sm" data-deny="${esc(r.id)}">Decline</button>
      <a class="btn btn-ghost btn-sm" href="profile.html?id=${esc(d.id)}">Check the driver</a>
    </div>
  </div>`;
}

function approvedCard(r) {
  return `
  <div style="padding:.7rem 0;border-bottom:1px solid var(--line)">
    <div class="row-between">
      <div><div class="strong small">${esc(r.rider?.full_name)} · ${esc(r.ride?.origin_label)} → ${esc(r.ride?.destination_label)}</div>
        <div class="tiny muted">${esc(whenLine(r.ride?.depart_date, r.ride?.depart_time))}
          · driver ${esc(r.ride?.driver?.full_name || '')}</div></div>
      <div class="row" style="gap:.3rem">
        <span class="badge ${r.status === 'accepted' ? 'badge-ok' : 'badge-warn'}">${esc(REQUEST_STATUS_LABELS[r.status])}</span>
        <button class="btn btn-ghost btn-sm" data-meetup="${esc(r.ride?.id)}">Meetup</button>
      </div>
    </div>
  </div>`;
}

function wire() {
  $('#inviteBtn')?.addEventListener('click', async (e) => {
    await withBusy(e.currentTarget, 'Generating…', async () => {
      try {
        const code = await createGuardianInvite();
        $('#inviteOut').innerHTML = `
          <div class="alert alert-ok">
            <div class="small">Give this code to your parent or guardian. They sign in to their own
            CarBuddy account, open this page, and press <strong>Link a rider</strong>.</div>
            <div class="mono" style="font-size:1.6rem;font-weight:800;letter-spacing:.2em;margin-top:.5rem">${esc(code)}</div>
          </div>`;
      } catch (err) { toastError(err); }
    });
  });

  $('#linkBtn')?.addEventListener('click', () => {
    modal({
      title: 'Link a young rider',
      body: `<p class="muted small">Ask them to open the Parent / Guardian page on their own account
        and press "Get my linking code". Enter that code here.</p>
        <label class="field"><span>Their code</span>
          <input type="text" id="code" placeholder="AB12CD" style="text-transform:uppercase;letter-spacing:.15em"></label>
        <label class="field"><span>Your relationship</span>
          <input type="text" id="rel" value="Parent" maxlength="40"></label>`,
      actions: [
        { label: 'Cancel', onClick: (_, c) => c() },
        { label: 'Link account', cls: 'btn-primary', onClick: async (root, close) => {
            const code = root.querySelector('#code').value.trim();
            if (!code) return toastError('Enter their code.');
            try {
              await claimGuardianInvite(code, root.querySelector('#rel').value);
              close(); toastOk('Linked — you will now approve their rides'); render();
            } catch (err) { toastError(err); }
          } },
      ],
    });
  });

  $$('[data-approve]').forEach((b) => b.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Approve this ride?',
      'The driver can then accept your rider. You will still see the meetup point and contact details.', 'Approve'))) return;
    await withBusy(e.currentTarget, 'Approving…', async () => {
      try { await decideRequest(e.currentTarget.dataset.approve, true); toastOk('Approved'); render(); }
      catch (err) { toastError(err); }
    });
  }));

  $$('[data-deny]').forEach((b) => b.addEventListener('click', (e) => {
    const id = e.currentTarget.dataset.deny;
    modal({
      title: 'Decline this ride',
      body: `<p class="muted small">Your rider is told straight away and the request is closed.</p>
        <label class="field"><span>Note to your rider (optional)</span>
          <input type="text" id="note" maxlength="200" placeholder="Let's talk about this one first."></label>`,
      actions: [
        { label: 'Cancel', onClick: (_, c) => c() },
        { label: 'Decline ride', cls: 'btn-danger', onClick: async (root, close) => {
            try {
              await decideRequest(id, false, root.querySelector('#note').value);
              close(); toastOk('Declined'); render();
            } catch (err) { toastError(err); }
          } },
      ],
    });
  }));

  $$('[data-meetup]').forEach((b) => b.addEventListener('click', async (e) => {
    const m = await dependentRideMeetup(e.currentTarget.dataset.meetup);
    modal({
      title: 'Meetup details',
      body: m?.meetup_place || m?.meetup_notes
        ? `<dl class="kv">${m.meetup_place ? `<dt>Meet at</dt><dd>${esc(m.meetup_place)}</dd>` : ''}
           ${m.meetup_notes ? `<dt>Notes</dt><dd>${esc(m.meetup_notes)}</dd>` : ''}</dl>`
        : '<p class="muted mb-0">The driver has not set a meetup point yet.</p>',
      actions: [{ label: 'Close', onClick: (_, c) => c() }],
    });
  }));

  $$('[data-revoke]').forEach((b) => b.addEventListener('click', async (e) => {
    if (!(await confirmDialog('Unlink this rider?',
      'They will no longer be able to join or post rides until another guardian links to them.', 'Unlink'))) return;
    try { await revokeGuardianLink(e.currentTarget.dataset.revoke); toastOk('Unlinked'); render(); }
    catch (err) { toastError(err); }
  }));
}

render();
