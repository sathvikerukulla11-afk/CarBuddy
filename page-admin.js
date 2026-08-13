import {
  mountChrome, requireAdmin, $, $$, esc, modal,
  toastOk, toastError, emptyState, loadingState, errorState,
} from './ui.js';
import * as admin from './admin.js';
import { VERIFICATION_LABELS, REPORT_CATEGORIES } from './constants.js';
import { whenLine, relativeTime } from './format.js';

await mountChrome();
const gate = await requireAdmin();
if (!gate) throw new Error('not an admin');

const panel = $('#panel');
let tab = 'reports';

$$('.tab').forEach((t) => t.addEventListener('click', () => {
  tab = t.dataset.tab;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  render();
}));

async function loadStats() {
  try {
    const s = await admin.stats();
    $('#repCount').textContent = String(s.reports_open || 0);
    const tile = (label, value, note = '') => `
      <div class="card"><div class="tiny muted" style="text-transform:uppercase;letter-spacing:.06em">${esc(label)}</div>
        <div style="font-size:1.8rem;font-weight:800;line-height:1.2">${esc(String(value))}</div>
        ${note ? `<div class="tiny muted">${esc(note)}</div>` : ''}</div>`;
    $('#stats').innerHTML =
      tile('Members', s.users, `${s.minors} under 18 · ${s.users_suspended} suspended`) +
      tile('Open reports', s.reports_open, 'awaiting moderation') +
      tile('Upcoming rides', s.rides_upcoming, `${s.rides_total} posted all time`) +
      tile('Pending requests', s.requests_pending, `${s.users_pending_verification} verification requests`);
  } catch (err) { toastError(err); }
}

const ADMIN_LOADING = {
  reports: 'Loading reports…', users: 'Loading members…',
  rides: 'Loading rides…', verification: 'Loading the verification queue…',
};

async function render() {
  panel.innerHTML = loadingState(ADMIN_LOADING[tab] || 'Loading…', 0);
  try {
    if (tab === 'reports')      return renderReports();
    if (tab === 'users')        return renderUsers();
    if (tab === 'rides')        return renderRides();
    return renderVerification();
  } catch (err) {
    toastError(err);
    panel.innerHTML = errorState(err, 'retryAdmin');
    $('#retryAdmin').addEventListener('click', render);
  }
}

/* -------------------------------------------------------------- reports -- */
async function renderReports() {
  const reports = await admin.listReports();
  if (!reports.length) {
    panel.innerHTML = emptyState('✅', 'No reports', 'Nothing has been reported yet.');
    return;
  }
  const cat = (v) => REPORT_CATEGORIES.find((c) => c.value === v)?.label || v;
  panel.innerHTML = `<div class="stack">${reports.map((r) => `
    <div class="card">
      <div class="row-between" style="align-items:flex-start">
        <div>
          <div class="strong">${esc(cat(r.category))}</div>
          <div class="tiny muted">Reported by ${esc(r.reporter?.full_name || 'unknown')}
            ${r.reported ? `about <a href="profile.html?id=${esc(r.reported.id)}">${esc(r.reported.full_name)}</a>` : ''}
            · ${esc(relativeTime(r.created_at))}</div>
        </div>
        <span class="badge ${r.status === 'open' ? 'badge-danger' : r.status === 'reviewing' ? 'badge-warn' : 'badge-ok'}">${esc(r.status)}</span>
      </div>
      <p class="small mt-2 mb-0" style="white-space:pre-wrap">${esc(r.details)}</p>
      ${r.admin_notes ? `<p class="tiny muted mt-1 mb-0">Admin note: ${esc(r.admin_notes)}</p>` : ''}
      <div class="row mt-2">
        ${r.ride_id ? `<a class="btn btn-ghost btn-sm" href="ride.html?id=${esc(r.ride_id)}">View ride</a>` : ''}
        ${r.status !== 'resolved' && r.status !== 'dismissed' ? `
          <button class="btn btn-secondary btn-sm" data-res="${esc(r.id)}" data-status="reviewing">Mark reviewing</button>
          <button class="btn btn-ok btn-sm" data-res="${esc(r.id)}" data-status="resolved">Resolve</button>
          <button class="btn btn-ghost btn-sm" data-res="${esc(r.id)}" data-status="dismissed">Dismiss</button>` : ''}
        ${r.reported ? `<button class="btn btn-danger btn-sm" data-susp="${esc(r.reported.id)}" data-on="${r.reported.is_suspended ? '0' : '1'}">
          ${r.reported.is_suspended ? 'Unsuspend' : 'Suspend'} ${esc(r.reported.full_name)}</button>` : ''}
      </div>
    </div>`).join('')}</div>`;

  $$('[data-res]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.res, status = b.dataset.status;
    modal({
      title: `Mark report as ${status}`,
      body: `<label class="field"><span>Internal note</span>
        <textarea id="note" maxlength="1000" placeholder="What did you do about it?"></textarea></label>`,
      actions: [
        { label: 'Cancel', onClick: (_, c) => c() },
        { label: 'Save', cls: 'btn-primary', onClick: async (root, close) => {
            try { await admin.resolveReport(id, status, root.querySelector('#note').value);
              close(); toastOk('Report updated'); loadStats(); render(); }
            catch (err) { toastError(err); }
          } },
      ],
    });
  }));
  wireSuspend();
}

/* ---------------------------------------------------------------- users -- */
async function renderUsers(search = '') {
  const users = await admin.listUsers(search);
  panel.innerHTML = `
    <input type="search" id="userSearch" placeholder="Search by name or email" class="mb-2" value="${esc(search)}">
    <div class="table-wrap"><table class="data"><thead><tr>
      <th>Member</th><th>Contact</th><th>Age</th><th>Verification</th><th>Rating</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${users.map((u) => `<tr>
      <td><a href="profile.html?id=${esc(u.id)}">${esc(u.full_name)}</a>
        ${u.is_admin ? '<span class="badge badge-brand">Admin</span>' : ''}</td>
      <td class="tiny">${esc(u.email || '—')}<br>${esc(u.phone || '')}</td>
      <td>${u.is_minor ? `<span class="badge badge-info">Under 18</span>
            ${u.has_guardian ? '<span class="badge badge-ok">Guardian ✓</span>' : '<span class="badge badge-danger">No guardian</span>'}`
          : '<span class="badge">Adult</span>'}</td>
      <td><span class="badge ${u.verification_status === 'verified' ? 'badge-ok' : u.verification_status === 'pending' ? 'badge-warn' : ''}">${esc(VERIFICATION_LABELS[u.verification_status])}</span></td>
      <td>${u.rating_count ? `${Number(u.rating_avg).toFixed(1)}★ (${u.rating_count})` : '—'}<br>
        <span class="tiny muted">${u.rides_completed} rides</span></td>
      <td>${u.is_suspended ? '<span class="badge badge-danger">Suspended</span>' : '<span class="badge badge-ok">Active</span>'}</td>
      <td><div class="row" style="gap:.25rem;flex-wrap:nowrap">
        <button class="btn btn-ghost btn-sm" data-verify="${esc(u.id)}">Verify…</button>
        <button class="btn btn-ghost btn-sm" data-susp="${esc(u.id)}" data-on="${u.is_suspended ? '0' : '1'}">${u.is_suspended ? 'Unsuspend' : 'Suspend'}</button>
      </div></td>
    </tr>`).join('')}
    </tbody></table></div>`;

  let t;
  $('#userSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => renderUsers(e.target.value), 300);
  });

  $$('[data-verify]').forEach((b) => b.addEventListener('click', () => verifyDialog(b.dataset.verify)));
  wireSuspend();
}

/* ---------------------------------------------------------------- rides -- */
async function renderRides() {
  const rides = await admin.listRides();
  if (!rides.length) { panel.innerHTML = emptyState('🚗', 'No rides yet', 'Nobody has posted a ride.'); return; }
  panel.innerHTML = `<div class="table-wrap"><table class="data"><thead><tr>
      <th>Route</th><th>When</th><th>Driver</th><th>Seats</th><th>Contribution</th><th>Visibility</th><th>Status</th><th></th>
    </tr></thead><tbody>
    ${rides.map((r) => `<tr>
      <td><a href="ride.html?id=${esc(r.id)}">${esc(r.origin_label)} → ${esc(r.destination_label)}</a></td>
      <td class="tiny">${esc(whenLine(r.depart_date, r.depart_time))}</td>
      <td class="tiny">${esc(r.driver?.full_name || '')}${r.driver?.is_suspended ? ' <span class="badge badge-danger">susp.</span>' : ''}</td>
      <td>${r.seats_taken}/${r.seats_offered}</td>
      <td>${Number(r.contribution_amount) > 0 ? '$' + Number(r.contribution_amount).toFixed(2) : '—'}</td>
      <td class="tiny">${esc(r.visibility)}</td>
      <td><span class="badge ${r.status === 'cancelled' ? 'badge-danger' : r.status === 'completed' ? 'badge-ok' : ''}">${esc(r.status)}</span></td>
      <td>${r.status === 'upcoming' ? `<button class="btn btn-danger btn-sm" data-rm="${esc(r.id)}">Remove</button>` : ''}</td>
    </tr>`).join('')}
    </tbody></table></div>`;

  $$('[data-rm]').forEach((b) => b.addEventListener('click', () => {
    modal({
      title: 'Remove this ride',
      body: `<p class="muted small">The ride is cancelled, all requests are closed, and everyone on
        board is notified. This cannot be undone.</p>
        <label class="field"><span>Reason shown to riders</span>
          <input type="text" id="reason" maxlength="200" value="Removed by moderation"></label>`,
      actions: [
        { label: 'Cancel', onClick: (_, c) => c() },
        { label: 'Remove ride', cls: 'btn-danger', onClick: async (root, close) => {
            try { await admin.removeRide(b.dataset.rm, root.querySelector('#reason').value);
              close(); toastOk('Ride removed'); loadStats(); render(); }
            catch (err) { toastError(err); }
          } },
      ],
    });
  }));
}

/* --------------------------------------------------------- verification -- */
async function renderVerification() {
  const users = (await admin.listUsers('', 300)).filter((u) => u.verification_status === 'pending');
  if (!users.length) {
    panel.innerHTML = emptyState('✅', 'Verification queue is empty', 'No members are waiting for review.');
    return;
  }
  panel.innerHTML = `<div class="stack">${users.map((u) => `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="strong"><a href="profile.html?id=${esc(u.id)}">${esc(u.full_name)}</a></div>
          <div class="tiny muted">${esc(u.email || '')} · ${esc(u.phone || 'no phone on file')}
            · joined ${esc(relativeTime(u.created_at))}
            ${u.is_minor ? (u.has_guardian ? ' · under 18, guardian linked' : ' · under 18, NO GUARDIAN') : ''}</div>
        </div>
        <div class="row">
          <button class="btn btn-ok btn-sm" data-v="${esc(u.id)}" data-s="verified">Approve</button>
          <button class="btn btn-secondary btn-sm" data-v="${esc(u.id)}" data-s="rejected">Reject</button>
        </div>
      </div>
    </div>`).join('')}</div>`;

  $$('[data-v]').forEach((b) => b.addEventListener('click', async () => {
    try { await admin.setVerification(b.dataset.v, b.dataset.s); toastOk('Verification updated'); loadStats(); render(); }
    catch (err) { toastError(err); }
  }));
}

/* -------------------------------------------------------------- helpers -- */
function verifyDialog(userId) {
  modal({
    title: 'Set verification status',
    body: `<div class="radio-cards">
      ${Object.entries(VERIFICATION_LABELS).map(([v, l], i) => `
        <label class="radio-card"><input type="radio" name="vs" value="${v}" ${i === 2 ? 'checked' : ''}>
          <span><strong>${esc(l)}</strong></span></label>`).join('')}
    </div>`,
    actions: [
      { label: 'Cancel', onClick: (_, c) => c() },
      { label: 'Apply', cls: 'btn-primary', onClick: async (root, close) => {
          const v = root.querySelector('input[name="vs"]:checked').value;
          try { await admin.setVerification(userId, v); close(); toastOk('Updated'); loadStats(); render(); }
          catch (err) { toastError(err); }
        } },
    ],
  });
}

function wireSuspend() {
  $$('[data-susp]').forEach((b) => b.addEventListener('click', () => {
    const on = b.dataset.on === '1';
    modal({
      title: on ? 'Suspend this member' : 'Restore this member',
      body: on
        ? `<p class="muted small">Their upcoming rides are cancelled and their pending requests are
           closed. They can still sign in but cannot post or join anything.</p>
           <label class="field"><span>Reason</span>
             <input type="text" id="reason" maxlength="200" placeholder="Repeated no-shows"></label>`
        : '<p class="muted small mb-0">They will be able to post and join rides again.</p>',
      actions: [
        { label: 'Cancel', onClick: (_, c) => c() },
        { label: on ? 'Suspend' : 'Restore', cls: on ? 'btn-danger' : 'btn-ok',
          onClick: async (root, close) => {
            try {
              await admin.suspendUser(b.dataset.susp, on, root.querySelector('#reason')?.value);
              close(); toastOk(on ? 'Member suspended' : 'Member restored'); loadStats(); render();
            } catch (err) { toastError(err); }
          } },
      ],
    });
  }));
}

loadStats();
render();
