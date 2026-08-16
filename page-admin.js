/**
 * CarBuddy admin console.
 *
 * Authorisation note: the sidebar and this file are a convenience, not the
 * security boundary. Every read and write below calls a Postgres function that
 * re-checks is_admin() server-side, and admin_actions / profiles are protected
 * by RLS. Deleting the `if (!profile.is_admin)` block here would change nothing
 * about what the database is willing to return.
 */
import {
  $, $$, esc, icon, currentSession, currentProfile, modal,
  toastOk, toastError, avatarEl, loadingState, errorState, emptyState, withBusy,
} from './ui.js';
import { signOut } from './auth.js';
import * as api from './admin.js';
import { relativeTime, whenLine, money } from './format.js';
import { REPORT_CATEGORIES, RIDE_STATUS_LABELS } from './constants.js';

/* ===================================================== access control ==== */
const session = await currentSession();
if (!session) {
  location.replace('login.html?next=admin.html');
  throw new Error('redirecting');
}
const me = await currentProfile(true);

if (!me?.is_admin) {
  document.getElementById('root').innerHTML = `
    <div class="deny">
      <div class="empty-icon" style="margin-inline:auto">🔒</div>
      <h1 style="font-size:1.5rem">Access denied</h1>
      <p class="muted">This area is for administrators. Every admin action is also
      refused by the database, so there is nothing here to work around.</p>
      <p class="tiny muted">Taking you back to CarBuddy…</p>
      <a class="btn btn-primary mt-2" href="index.html">Back to CarBuddy</a>
    </div>`;
  setTimeout(() => location.replace('index.html'), 2500);
  throw new Error('not an admin');
}

/* =========================================================== the shell === */
const SECTIONS = [
  { id: 'dashboard',    label: 'Dashboard',    ico: '▤' },
  { id: 'users',        label: 'Users',        ico: '⛁' },
  { id: 'rides',        label: 'Rides',        ico: '⇄' },
  { id: 'reports',      label: 'Reports',      ico: '⚑' },
  { id: 'analytics',    label: 'Analytics',    ico: '◫' },
  { id: 'settings',     label: 'Settings',     ico: '⚙' },
];

document.getElementById('root').innerHTML = `
  <div class="admin-shell">
    <div class="admin-scrim" id="scrim"></div>
    <aside class="admin-side" id="side">
      <a class="admin-brand" href="index.html">
        <span class="brand-mark" aria-hidden="true">${icon('car', 16)}</span>
        CarBuddy <span class="tag">Admin</span>
      </a>
      <nav class="admin-nav" id="adminNav" aria-label="Admin sections">
        ${SECTIONS.map((s) => `
          <a href="#${s.id}" data-section="${s.id}">
            <span class="admin-nav-ico" aria-hidden="true">${s.ico}</span>${s.label}
            <span class="admin-nav-count hidden" data-count="${s.id}"></span>
          </a>`).join('')}
      </nav>
      <div class="admin-side-foot">
        <a class="admin-side-user" href="profile.html">
          ${avatarEl(me, 'avatar-sm')}
          <span style="min-width:0">
            <span class="strong small" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(me.full_name)}</span>
            <span class="tiny muted">Administrator</span>
          </span>
        </a>
        <button class="btn btn-secondary btn-sm btn-block mt-1" id="adminLogout">Log out</button>
      </div>
    </aside>

    <main class="admin-main">
      <div class="admin-topbar">
        <button class="admin-burger" id="burger" aria-label="Open admin menu"
                aria-expanded="false" aria-controls="side">${icon('menu', 18)}</button>
        <h1 id="pageTitle">Dashboard</h1>
        <span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" id="refreshBtn" title="Reload this section">Refresh</button>
      </div>
      <div id="view"></div>
    </main>
  </div>`;

const view = $('#view');

/* sidebar on small screens */
const side = $('#side'), scrim = $('#scrim'), burger = $('#burger');
const setMenu = (open) => {
  side.classList.toggle('open', open);
  scrim.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
};
burger.addEventListener('click', () => setMenu(!side.classList.contains('open')));
scrim.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

$('#adminLogout').addEventListener('click', async (e) => {
  e.currentTarget.disabled = true;
  e.currentTarget.textContent = 'Signing out…';
  try { await signOut(); } catch { /* local session is what matters */ }
  location.href = 'index.html';
});

/* ============================================================ helpers ==== */
const REPORT_STATUS = {
  open:      { label: 'Pending',      cls: 'badge-danger' },
  reviewing: { label: 'Under review', cls: 'badge-warn' },
  resolved:  { label: 'Resolved',     cls: 'badge-ok' },
  dismissed: { label: 'Dismissed',    cls: 'badge-quiet' },
};
const RIDE_STATUS_CLS = {
  upcoming: 'badge-info', active: 'badge-warn', completed: 'badge-ok', cancelled: 'badge-quiet',
};
const catLabel = (v) => REPORT_CATEGORIES.find((c) => c.value === v)?.label || v;
const num = (v) => Number(v ?? 0).toLocaleString();
const dateOnly = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function personCell(p) {
  return `<span class="cell-person">${avatarEl(p, 'avatar-xs')}<span class="nm">${esc(p?.full_name || '—')}</span></span>`;
}

/** Slide-over panel used for every detail view. */
function drawer(title, bodyHtml) {
  document.querySelector('.drawer-scrim')?.remove();
  document.querySelector('.drawer')?.remove();

  const scrimEl = document.createElement('div');
  scrimEl.className = 'drawer-scrim';
  const el = document.createElement('aside');
  el.className = 'drawer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="drawer-head">
      <h2 style="font-size:1.1rem;margin:0">${esc(title)}</h2>
      <button class="btn btn-ghost btn-sm" data-close aria-label="Close">${icon('close', 16)}</button>
    </div>
    <div class="drawer-body">${bodyHtml}</div>`;
  document.body.append(scrimEl, el);
  document.body.style.overflow = 'hidden';

  const close = () => {
    el.remove(); scrimEl.remove(); document.body.style.overflow = '';
  };
  scrimEl.addEventListener('click', close);
  el.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', function onEsc(ev) {
    if (ev.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });
  return { el, close };
}

/** Swap a drawer's body once its data arrives. */
const setDrawerBody = (d, html) => { d.el.querySelector('.drawer-body').innerHTML = html; };

/* ------------------------------------------------------------- charts --- */
/** Multi-series area/line chart drawn as plain SVG — no chart library. */
function lineChart(series, keys, { height = 190 } = {}) {
  const w = 720, h = height, padL = 34, padR = 8, padT = 12, padB = 24;
  const max = Math.max(1, ...series.flatMap((d) => keys.map((k) => Number(d[k.key] || 0))));
  const n = series.length;
  const x = (i) => padL + (i * (w - padL - padR)) / Math.max(1, n - 1);
  const y = (v) => h - padB - (Number(v || 0) / max) * (h - padT - padB);

  const gridVals = [0, max / 2, max].map((v) => Math.round(v));
  const grid = [...new Set(gridVals)].map((v) => `
    <line x1="${padL}" x2="${w - padR}" y1="${y(v)}" y2="${y(v)}"
          stroke="var(--line)" stroke-width="1"/>
    <text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end"
          font-size="10" fill="var(--muted-2)">${v}</text>`).join('');

  const paths = keys.map((k) => {
    const pts = series.map((d, i) => `${x(i)},${y(d[k.key])}`).join(' ');
    const area = `${padL},${h - padB} ${pts} ${x(n - 1)},${h - padB}`;
    return `
      ${k.fill ? `<polygon points="${area}" fill="${k.color}" opacity=".10"/>` : ''}
      <polyline points="${pts}" fill="none" stroke="${k.color}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  const step = Math.max(1, Math.floor(n / 6));
  const labels = series.map((d, i) => (i % step === 0 || i === n - 1)
    ? `<text x="${x(i)}" y="${h - 6}" text-anchor="middle" font-size="10" fill="var(--muted-2)">${
        new Date(d.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>` : '').join('');

  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img"
            aria-label="${esc(keys.map((k) => k.label).join(', '))} over time">
      ${grid}${paths}${labels}</svg>`;
}

function barChart(rows, { labelKey, valueKey, height = 170 }) {
  const w = 720, h = height, padL = 30, padB = 26, padT = 10;
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey] || 0)));
  const bw = (w - padL) / Math.max(1, rows.length);
  return `<svg class="chart-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Distribution">
    ${rows.map((r, i) => {
      const v = Number(r[valueKey] || 0);
      const bh = (v / max) * (h - padT - padB);
      return `<rect x="${padL + i * bw + bw * 0.18}" y="${h - padB - bh}"
                width="${bw * 0.64}" height="${Math.max(v ? 2 : 0, bh)}"
                rx="3" fill="var(--navy-600)" opacity="${v ? 0.9 : 0.15}"/>
              <text x="${padL + i * bw + bw / 2}" y="${h - 8}" text-anchor="middle"
                    font-size="10" fill="var(--muted-2)">${esc(String(r[labelKey]))}</text>`;
    }).join('')}
  </svg>`;
}

const notEnoughData = (msg = 'Not enough data yet') =>
  `<div class="chart-empty">${esc(msg)}</div>`;

/* ============================================================= router ==== */
const routes = {
  dashboard: renderDashboard,
  users: renderUsers,
  rides: renderRides,
  reports: renderReports,
  analytics: renderAnalytics,
  settings: renderSettings,
};

function currentRoute() {
  const id = (location.hash || '#dashboard').slice(1).split('?')[0];
  return routes[id] ? id : 'dashboard';
}

async function route() {
  const id = currentRoute();
  $$('#adminNav a').forEach((a) => a.classList.toggle('active', a.dataset.section === id));
  $('#pageTitle').textContent = SECTIONS.find((s) => s.id === id).label;
  setMenu(false);
  await routes[id]();
}

window.addEventListener('hashchange', route);
$('#refreshBtn').addEventListener('click', route);

/** Wraps a section render with loading + error states. */
async function section(loadingMsg, fn) {
  view.innerHTML = loadingState(loadingMsg, 0) + '<div class="skeleton" style="height:220px"></div>';
  try {
    await fn();
  } catch (err) {
    view.innerHTML = errorState(err, 'adminRetry');
    $('#adminRetry').addEventListener('click', route);
  }
}

/* keeps the sidebar badges honest */
async function refreshCounts() {
  try {
    const o = await api.overview();
    const set = (id, n) => {
      const el = document.querySelector(`[data-count="${id}"]`);
      if (!el) return;
      el.textContent = n;
      el.classList.toggle('hidden', !n);
    };
    set('reports', o.reports_open_total);
  } catch { /* the section itself will surface the error */ }
}

/* ========================================================== DASHBOARD ==== */
async function renderDashboard() {
  await section('Loading dashboard…', async () => {
    const [o, activity] = await Promise.all([api.overview(), api.recentActivity(12)]);

    const kpi = (label, value, note, cls = '', href = '') => {
      const inner = `<span class="kpi-label">${esc(label)}</span>
        <span class="kpi-value">${num(value)}</span>
        <span class="kpi-note">${esc(note)}</span>`;
      return href ? `<a class="kpi ${cls}" href="${href}">${inner}</a>`
                  : `<div class="kpi ${cls}">${inner}</div>`;
    };

    const safety = o.reports_safety + o.minors_no_guardian + o.users_suspended;

    view.innerHTML = `
      <div class="kpi-grid">
        ${kpi('Total users', o.users_total, `${num(o.users_new_7d)} joined in the last 7 days`, '', '#users')}
        ${kpi('Active users', o.users_active, 'signed in within 30 days', '', '#users')}
        ${kpi('Total rides', o.rides_total, `${num(o.rides_cancelled)} cancelled all time`, '', '#rides')}
        ${kpi('Upcoming rides', o.rides_upcoming, `${num(o.rides_active)} under way now`, '', '#rides')}
        ${kpi('Completed rides', o.rides_completed, 'finished journeys', '', '#rides')}
        ${kpi('Pending reports', o.reports_pending,
              o.reports_reviewing ? `${num(o.reports_reviewing)} more under review` : 'nothing under review',
              o.reports_pending ? 'kpi-danger' : '', '#reports')}
        ${kpi('Open requests', o.requests_pending, 'riders awaiting a driver', '', '#rides')}
      </div>

      <section class="admin-section">
        <div class="admin-section-head">
          <h2>Safety &amp; reports</h2>
          <a class="small" href="#reports">Open the report queue</a>
        </div>
        <div class="kpi-grid">
          ${kpi('Safety-flagged reports', o.reports_safety, 'unsafe driving, harassment, minors',
                o.reports_safety ? 'kpi-danger' : '', '#reports')}
          ${kpi('Repeat reported members', o.repeat_offenders, 'reported more than once',
                o.repeat_offenders ? 'kpi-alert' : '', '#reports')}
          ${kpi('Suspended accounts', o.users_suspended, 'cannot post or join', '', '#users')}
          ${kpi('Under-18 without guardian', o.minors_no_guardian, 'blocked from riding until linked',
                o.minors_no_guardian ? 'kpi-alert' : '', '#users')}
        </div>
        ${safety === 0 ? `<p class="small muted mt-3 mb-0">
          Nothing needs attention right now — no open safety reports, no repeat-reported
          members and no suspended accounts.</p>` : ''}
      </section>

      <section class="admin-section">
        <div class="admin-section-head"><h2>Recent activity</h2></div>
        <div class="card">
          ${activity.length ? activity.map(activityRow).join('')
            : '<p class="small muted mb-0">No activity yet.</p>'}
        </div>
      </section>`;
    refreshCounts();
  });
}

function activityRow(a) {
  const tone = { report_submitted: 'danger', ride_completed: 'ok' }[a.kind] || '';
  const label = {
    user_registered: 'New member', ride_posted: 'Ride posted', ride_completed: 'Ride completed',
    report_submitted: 'Report submitted',
  }[a.kind] || a.kind;
  return `
    <div class="log-row">
      <span class="log-dot ${tone}"></span>
      <div style="min-width:0">
        <div class="small"><span class="strong">${esc(label)}</span>
          <span class="muted"> · ${esc(a.actor_name || 'Unknown')}</span></div>
        <div class="tiny muted">${esc(a.subject || '')}</div>
      </div>
      <div style="text-align:right">
        <div class="tiny muted">${esc(relativeTime(a.occurred_at))}</div>
        ${a.status ? `<span class="badge badge-quiet" style="margin-top:4px">${esc(a.status)}</span>` : ''}
      </div>
    </div>`;
}

/* ============================================================== USERS ==== */
let userFilter = 'all', userSearch = '';

async function renderUsers() {
  await section('Loading users…', async () => {
    const users = await api.listUsers(userSearch, 300);
    const filtered = users.filter((u) =>
      userFilter === 'all' ? true
      : userFilter === 'suspended' ? u.is_suspended
      : userFilter === 'minors' ? u.is_minor
      : true);

    view.innerHTML = `
      <div class="admin-toolbar">
        <input class="admin-search" type="search" id="userSearch"
               placeholder="Search users by name or email…" value="${esc(userSearch)}">
        <div class="filter-chips" role="group" aria-label="Filter users">
          ${[['all', 'All'], ['suspended', 'Suspended'], ['minors', 'Under 18']]
            .map(([v, l]) => `<button class="filter-chip ${userFilter === v ? 'active' : ''}" data-filter="${v}">${l}</button>`).join('')}
        </div>
        <span class="spacer"></span>
        <span class="small muted">${filtered.length} of ${users.length}</span>
      </div>

      ${filtered.length ? `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Member</th><th>Email</th><th>Rating</th>
            <th>Rides</th><th>Status</th><th>Joined</th><th></th>
          </tr></thead>
          <tbody>
            ${filtered.map((u) => `
              <tr>
                <td data-label="Member">${personCell(u)}
                  ${u.is_admin ? '<span class="badge badge-brand">Admin</span>' : ''}
                  ${u.is_minor ? '<span class="badge badge-info">Under 18</span>' : ''}</td>
                <td data-label="Email"><span class="tiny">${esc(u.email || '—')}</span></td>
                <td data-label="Rating">${u.rating_count
                  ? `<span class="stars">★</span> ${Number(u.rating_avg).toFixed(1)} <span class="tiny muted">(${u.rating_count})</span>`
                  : '<span class="tiny muted">—</span>'}</td>
                <td data-label="Completed rides">${u.rides_completed}</td>
                <td data-label="Status">${u.is_suspended
                  ? '<span class="badge badge-danger">Suspended</span>'
                  : '<span class="badge badge-ok">Active</span>'}</td>
                <td data-label="Joined"><span class="tiny muted">${dateOnly(u.created_at)}</span></td>
                <td><button class="btn btn-secondary btn-sm" data-user="${esc(u.id)}">View</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('🔍', 'No users match',
          userSearch || userFilter !== 'all'
            ? 'Try a different search or filter.'
            : 'Nobody has signed up yet.')}`;

    let t;
    $('#userSearch').addEventListener('input', (e) => {
      clearTimeout(t);
      userSearch = e.target.value;
      t = setTimeout(renderUsers, 300);
    });
    $$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      userFilter = b.dataset.filter; renderUsers();
    }));
    $$('[data-user]').forEach((b) => b.addEventListener('click', () => openUser(b.dataset.user)));
  });
}

async function openUser(id) {
  const d = drawer('Member', loadingState('Loading member…', 0));
  try {
    const [info, rides, reports] = await Promise.all([
      api.userDetail(id), api.userRides(id), api.userReports(id),
    ]);
    const p = info.profile, c = info.counts;

    setDrawerBody(d, `
      <div class="card">
        <div class="row" style="gap:16px;align-items:flex-start">
          ${avatarEl(p, 'avatar-lg')}
          <div style="min-width:0;flex:1">
            <div class="person-name">${esc(p.full_name)}</div>
            <div class="row mt-1" style="gap:6px">
              ${p.is_suspended ? '<span class="badge badge-danger">Suspended</span>' : '<span class="badge badge-ok">Active</span>'}
              ${p.is_admin ? '<span class="badge badge-brand">Admin</span>' : ''}
              ${p.is_minor ? `<span class="badge ${info.has_guardian ? 'badge-info' : 'badge-danger'}">
                Under 18${info.has_guardian ? ' · guardian linked' : ' · NO GUARDIAN'}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="detail-list mt-3">
          <div class="detail-row"><span class="detail-key">Email</span><span class="detail-val">${esc(info.email || '—')}</span></div>
          <div class="detail-row"><span class="detail-key">Phone</span><span class="detail-val">${esc(info.phone || '—')}</span></div>
          <div class="detail-row"><span class="detail-key">Rating</span><span class="detail-val">${
            p.rating_count ? `${Number(p.rating_avg).toFixed(1)} from ${p.rating_count}` : 'No ratings yet'}</span></div>
          <div class="detail-row"><span class="detail-key">Completed rides</span><span class="detail-val">${p.rides_completed}</span></div>
          <div class="detail-row"><span class="detail-key">Joined</span><span class="detail-val">${dateOnly(p.created_at)}</span></div>
          <div class="detail-row"><span class="detail-key">Last signed in</span><span class="detail-val">${
            info.last_sign_in_at ? relativeTime(info.last_sign_in_at) : 'Never'}</span></div>
          <div class="detail-row"><span class="detail-key">Role</span><span class="detail-val">${esc(p.role || (p.is_admin ? 'admin' : 'user'))}</span></div>
          ${p.is_suspended && p.suspended_reason
            ? `<div class="detail-row"><span class="detail-key">Suspended because</span><span class="detail-val">${esc(p.suspended_reason)}</span></div>` : ''}
          ${info.guardians?.length
            ? `<div class="detail-row"><span class="detail-key">Guardian</span><span class="detail-val">${
                info.guardians.map((g) => esc(g.name)).join(', ')}</span></div>` : ''}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Ride history</h3>
          <span class="badge">${c.rides_posted} posted · ${c.rides_joined} joined</span></div>
        ${rides.length ? `<div class="detail-list">${rides.map((r) => `
          <div class="detail-row">
            <span style="min-width:0">
              <span class="small strong">${esc(r.origin_label)} → ${esc(r.destination_label)}</span><br>
              <span class="tiny muted">${esc(r.relationship)} · ${esc(whenLine(r.depart_date, r.depart_time))}</span>
            </span>
            <span class="badge ${RIDE_STATUS_CLS[r.status] || ''}">${esc(RIDE_STATUS_LABELS[r.status] || r.status)}</span>
          </div>`).join('')}</div>`
          : '<p class="small muted mb-0">No rides yet.</p>'}
      </div>

      <div class="card">
        <div class="card-head"><h3>Reports</h3>
          <span class="badge ${c.reports_against ? 'badge-danger' : ''}">${c.reports_against} against · ${c.reports_filed} filed</span></div>
        ${reports.length ? `<div class="detail-list">${reports.map((r) => `
          <div class="detail-row">
            <span style="min-width:0">
              <span class="small strong">${esc(catLabel(r.category))}</span><br>
              <span class="tiny muted">${esc(r.direction)} · ${esc(r.other_party || 'unknown')} · ${esc(relativeTime(r.created_at))}</span>
            </span>
            <span class="badge ${REPORT_STATUS[r.status]?.cls || ''}">${esc(REPORT_STATUS[r.status]?.label || r.status)}</span>
          </div>`).join('')}</div>`
          : '<p class="small muted mb-0">No reports involve this member.</p>'}
      </div>

      <div class="card">
        <div class="card-head"><h3>Actions</h3></div>
        <div class="stack-sm">
          ${p.is_suspended
            ? `<button class="btn btn-ok btn-block" data-act="unsuspend">Reinstate account</button>`
            : `<button class="btn btn-danger btn-block" data-act="suspend">Suspend account</button>`}
        </div>
        <p class="tiny muted mt-2 mb-0">Suspending cancels their upcoming rides and pending
        requests. Every action here is written to the admin log.</p>
      </div>`);

    d.el.querySelector('[data-act="suspend"]')?.addEventListener('click', () => suspendDialog(p, true, d));
    d.el.querySelector('[data-act="unsuspend"]')?.addEventListener('click', () => suspendDialog(p, false, d));
  } catch (err) {
    setDrawerBody(d, errorState(err, 'drawerRetry'));
    d.el.querySelector('#drawerRetry')?.addEventListener('click', () => { d.close(); openUser(id); });
  }
}

function suspendDialog(p, suspend, d) {
  modal({
    title: suspend ? `Suspend ${p.full_name}?` : `Reinstate ${p.full_name}?`,
    body: suspend
      ? `<p class="muted small">Their upcoming rides are cancelled and pending requests closed.
         They can still sign in but cannot post or join anything.</p>
         <label class="field" style="margin:0"><span>Reason (kept in the admin log)</span>
           <input type="text" id="reason" maxlength="200" placeholder="Repeated no-shows"></label>`
      : '<p class="muted small mb-0">They will be able to post and join rides again.</p>',
    actions: [
      { label: 'Cancel', onClick: (_, close) => close() },
      { label: suspend ? 'Suspend account' : 'Reinstate', cls: suspend ? 'btn-danger' : 'btn-ok',
        onClick: async (root, close) => {
          try {
            await api.suspendUser(p.id, suspend, root.querySelector('#reason')?.value);
            close(); d?.close();
            toastOk(suspend ? 'Account suspended' : 'Account reinstated');
            route();
          } catch (err) { toastError(err); }
        } },
    ],
  });
}

/* ============================================================== RIDES ==== */
let rideFilter = '', rideSearch = '';

async function renderRides() {
  await section('Loading rides…', async () => {
    const rides = await api.listRides(rideFilter, rideSearch, 300);

    view.innerHTML = `
      <div class="admin-toolbar">
        <input class="admin-search" type="search" id="rideSearch"
               placeholder="Search by driver, from or to…" value="${esc(rideSearch)}">
        <div class="filter-chips" role="group" aria-label="Filter rides">
          ${[['', 'All'], ['upcoming', 'Upcoming'], ['active', 'Under way'],
             ['completed', 'Completed'], ['cancelled', 'Cancelled']]
            .map(([v, l]) => `<button class="filter-chip ${rideFilter === v ? 'active' : ''}" data-rfilter="${v}">${l}</button>`).join('')}
        </div>
        <span class="spacer"></span>
        <span class="small muted">${rides.length} ride${rides.length === 1 ? '' : 's'}</span>
      </div>

      ${rides.length ? `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Driver</th><th>Route</th><th>When</th><th>Seats</th>
            <th>Contribution</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rides.map((r) => `
              <tr>
                <td data-label="Driver">${personCell({ full_name: r.driver_name })}
                  ${r.driver_suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}</td>
                <td data-label="Route"><span class="small">${esc(r.origin_label)} → ${esc(r.destination_label)}</span></td>
                <td data-label="When"><span class="tiny">${esc(whenLine(r.depart_date, r.depart_time))}</span></td>
                <td data-label="Seats">${r.seats_taken}/${r.seats_offered}
                  <span class="tiny muted">(${r.seats_remaining} free)</span></td>
                <td data-label="Contribution">${Number(r.contribution_amount) > 0 ? esc(money(r.contribution_amount)) : '—'}</td>
                <td data-label="Status"><span class="badge ${RIDE_STATUS_CLS[r.status] || ''}">${esc(RIDE_STATUS_LABELS[r.status] || r.status)}</span></td>
                <td><button class="btn btn-secondary btn-sm" data-ride="${esc(r.id)}">View</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('🚗', 'No rides found',
          rideSearch || rideFilter ? 'Try a different search or filter.' : 'Nobody has posted a ride yet.')}`;

    let t;
    $('#rideSearch').addEventListener('input', (e) => {
      clearTimeout(t); rideSearch = e.target.value; t = setTimeout(renderRides, 300);
    });
    $$('[data-rfilter]').forEach((b) => b.addEventListener('click', () => {
      rideFilter = b.dataset.rfilter; renderRides();
    }));
    $$('[data-ride]').forEach((b) => b.addEventListener('click', () => openRide(b.dataset.ride)));
  });
}

async function openRide(id) {
  const d = drawer('Ride', loadingState('Loading ride…', 0));
  try {
    const info = await api.rideDetail(id);
    const r = info.ride, dr = info.driver, riders = info.riders || [];

    setDrawerBody(d, `
      <div class="card">
        <span class="label-quiet">${esc(whenLine(r.depart_date, r.depart_time))}</span>
        <div class="mt-2" style="font-size:1.2rem;font-weight:600;color:var(--navy-900)">
          ${esc(r.origin_label)}<br>
          <span style="color:var(--muted-2);font-size:.9rem">↓</span><br>
          ${esc(r.destination_label)}
        </div>
        <div class="ride-meta mt-3">
          <span class="badge ${RIDE_STATUS_CLS[r.status] || ''}">${esc(RIDE_STATUS_LABELS[r.status] || r.status)}</span>
          <span class="badge">${r.seats_taken}/${r.seats_offered} seats taken</span>
          <span class="badge">${r.seats_remaining} free</span>
          ${Number(r.contribution_amount) > 0 ? `<span class="badge">${esc(money(r.contribution_amount))}</span>` : ''}
        </div>
        ${r.cancelled_reason ? `<p class="small muted mt-2 mb-0">Cancelled: ${esc(r.cancelled_reason)}</p>` : ''}
      </div>

      <div class="card">
        <div class="card-head"><h3>Driver</h3></div>
        <div class="row" style="gap:12px">
          ${avatarEl(dr, '')}
          <div style="min-width:0">
            <div class="strong">${esc(dr.full_name)}</div>
            <div class="row mt-1" style="gap:6px">
              ${dr.rating_count ? `<span class="small"><span class="stars">★</span> ${Number(dr.rating_avg).toFixed(1)}</span>`
                                : '<span class="small muted">No ratings</span>'}
              ${dr.is_suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}
            </div>
          </div>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" data-open-user="${esc(dr.id)}">Open</button>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h3>Riders</h3><span class="badge">${riders.filter((x) => x.status === 'joined').length}</span></div>
        ${riders.length ? riders.map((x) => `
          <div class="list-row">
            <div class="row" style="gap:10px;min-width:0">
              ${avatarEl(x, 'avatar-sm')}
              <div style="min-width:0">
                <div class="small strong">${esc(x.full_name)}</div>
                <div class="tiny muted">${x.seats} seat${x.seats === 1 ? '' : 's'}${x.is_minor ? ' · under 18' : ''}</div>
              </div>
            </div>
            <div class="row" style="gap:6px">
              <span class="badge ${x.status === 'joined' ? 'badge-ok' : 'badge-quiet'}">${esc(x.status)}</span>
              <button class="btn btn-ghost btn-sm" data-open-user="${esc(x.id)}">Open</button>
            </div>
          </div>`).join('')
          : '<p class="small muted mb-0">Nobody joined this ride.</p>'}
      </div>

      ${info.meetup?.meetup_place ? `
      <div class="card">
        <div class="card-head"><h3>Meetup</h3></div>
        <p class="small mb-0">${esc(info.meetup.meetup_place)}</p>
      </div>` : ''}

      ${['upcoming', 'active'].includes(r.status) ? `
      <div class="card">
        <div class="card-head"><h3>Actions</h3></div>
        <button class="btn btn-danger btn-block" id="cancelRideBtn">Cancel this ride</button>
        <p class="tiny muted mt-2 mb-0">This cancels the real ride in the database and notifies
        everyone on board. It is not hidden from this list.</p>
      </div>` : ''}`);

    d.el.querySelectorAll('[data-open-user]').forEach((b) =>
      b.addEventListener('click', () => { d.close(); openUser(b.dataset.openUser); }));

    d.el.querySelector('#cancelRideBtn')?.addEventListener('click', () => {
      modal({
        title: 'Cancel this ride?',
        body: `<p class="muted small">Everyone with a seat is notified. The ride stays visible
          here with a cancelled status — it is not deleted.</p>
          <label class="field" style="margin:0"><span>Reason shown to riders</span>
            <input type="text" id="reason" maxlength="200" value="Cancelled by moderation"></label>`,
        actions: [
          { label: 'Keep the ride', onClick: (_, close) => close() },
          { label: 'Cancel ride', cls: 'btn-danger', onClick: async (root, close) => {
              try {
                await api.cancelRide(r.id, root.querySelector('#reason').value);
                close(); d.close(); toastOk('Ride cancelled'); route();
              } catch (err) { toastError(err); }
            } },
        ],
      });
    });
  } catch (err) {
    setDrawerBody(d, errorState(err, 'drawerRetry'));
    d.el.querySelector('#drawerRetry')?.addEventListener('click', () => { d.close(); openRide(id); });
  }
}

/* ============================================================ REPORTS ==== */
let reportFilter = '';

async function renderReports() {
  await section('Loading reports…', async () => {
    const reports = await api.listReports(reportFilter);

    view.innerHTML = `
      <div class="admin-toolbar">
        <div class="filter-chips" role="group" aria-label="Filter reports">
          ${[['', 'All'], ['open', 'Pending'], ['reviewing', 'Under review'],
             ['resolved', 'Resolved'], ['dismissed', 'Dismissed']]
            .map(([v, l]) => `<button class="filter-chip ${reportFilter === v ? 'active' : ''}" data-repfilter="${v}">${l}</button>`).join('')}
        </div>
        <span class="spacer"></span>
        <span class="small muted">${reports.length} report${reports.length === 1 ? '' : 's'}</span>
      </div>

      ${reports.length ? `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Report</th><th>Reported member</th><th>Reporter</th>
            <th>Ride</th><th>Filed</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${reports.map((r) => `
              <tr>
                <td data-label="Report">
                  <span class="small strong">${esc(catLabel(r.category))}</span>
                  ${r.is_safety ? '<span class="badge badge-danger">Safety</span>' : ''}
                  <div class="tiny muted mono">${esc(r.id.slice(0, 8))}</div>
                </td>
                <td data-label="Reported member">${r.reported_name ? personCell({ full_name: r.reported_name }) : '<span class="tiny muted">—</span>'}
                  ${r.reported_suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}
                  ${r.reported_prior_reports > 0 ? `<span class="badge badge-warn">${r.reported_prior_reports} prior</span>` : ''}</td>
                <td data-label="Reporter"><span class="tiny">${esc(r.reporter_name || '—')}</span></td>
                <td data-label="Ride"><span class="tiny">${esc(r.ride_label || '—')}</span></td>
                <td data-label="Filed"><span class="tiny muted">${esc(relativeTime(r.created_at))}</span></td>
                <td data-label="Status"><span class="badge ${REPORT_STATUS[r.status]?.cls || ''}">${esc(REPORT_STATUS[r.status]?.label || r.status)}</span></td>
                <td><button class="btn btn-secondary btn-sm" data-report="${esc(r.id)}">View</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('✓', 'No reports found',
          reportFilter ? 'Nothing in this status. Try another filter.' : 'Nobody has reported anything yet.')}`;

    $$('[data-repfilter]').forEach((b) => b.addEventListener('click', () => {
      reportFilter = b.dataset.repfilter; renderReports();
    }));
    $$('[data-report]').forEach((b) => b.addEventListener('click', () => openReport(b.dataset.report)));
  });
}

async function openReport(id) {
  const d = drawer('Report', loadingState('Loading report…', 0));
  try {
    const info = await api.reportDetail(id);
    const r = info.report, target = info.reported, reporter = info.reporter;

    setDrawerBody(d, `
      <div class="card">
        <div class="row-between" style="align-items:flex-start">
          <div>
            <span class="label-quiet">Report ${esc(r.id.slice(0, 8))}</span>
            <h3 style="margin:.3rem 0 0">${esc(catLabel(r.category))}</h3>
          </div>
          <span class="badge ${REPORT_STATUS[r.status]?.cls || ''}">${esc(REPORT_STATUS[r.status]?.label || r.status)}</span>
        </div>
        <div class="detail-list mt-3">
          <div class="detail-row"><span class="detail-key">Filed</span><span class="detail-val">${dateOnly(r.created_at)} · ${esc(relativeTime(r.created_at))}</span></div>
          <div class="detail-row"><span class="detail-key">Reporter</span><span class="detail-val">${esc(reporter?.full_name || '—')}</span></div>
          <div class="detail-row"><span class="detail-key">Reported member</span><span class="detail-val">${esc(target?.full_name || '—')}</span></div>
          <div class="detail-row"><span class="detail-key">Related ride</span><span class="detail-val">${
            info.ride ? esc(info.ride.origin_label + ' → ' + info.ride.destination_label) : '—'}</span></div>
        </div>
        <div class="mt-3">
          <div class="label">Description</div>
          <p class="small mb-0" style="white-space:pre-wrap;color:var(--ink-2)">${esc(r.details)}</p>
        </div>
        ${r.admin_notes ? `<div class="mt-3"><div class="label">Admin notes</div>
          <p class="small muted mb-0">${esc(r.admin_notes)}</p></div>` : ''}
      </div>

      ${target ? `
      <div class="card">
        <div class="card-head"><h3>About the reported member</h3>
          <button class="btn btn-ghost btn-sm" data-open-user="${esc(target.id)}">Open</button></div>
        <div class="row" style="gap:12px">
          ${avatarEl(target, '')}
          <div>
            <div class="strong">${esc(target.full_name)}</div>
            <div class="row mt-1" style="gap:6px">
              ${target.rating_count ? `<span class="small"><span class="stars">★</span> ${Number(target.rating_avg).toFixed(1)} (${target.rating_count})</span>`
                                    : '<span class="small muted">No ratings</span>'}
              ${target.is_suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}
              ${target.is_minor ? '<span class="badge badge-info">Under 18</span>' : ''}
            </div>
          </div>
        </div>
        <div class="detail-list mt-3">
          <div class="detail-row"><span class="detail-key">Completed rides</span><span class="detail-val">${target.rides_completed}</span></div>
          <div class="detail-row"><span class="detail-key">Member since</span><span class="detail-val">${dateOnly(target.created_at)}</span></div>
          <div class="detail-row"><span class="detail-key">Previous reports</span>
            <span class="detail-val">${info.prior_reports.length
              ? `<span class="badge badge-warn">${info.prior_reports.length}</span>` : 'None'}</span></div>
        </div>
        ${info.prior_reports.length ? `<div class="mt-3"><div class="label">Previous reports</div>
          ${info.prior_reports.map((pr) => `<div class="list-row">
            <span class="small">${esc(catLabel(pr.category))}<span class="tiny muted"> · ${esc(relativeTime(pr.created_at))}</span></span>
            <span class="badge ${REPORT_STATUS[pr.status]?.cls || ''}">${esc(REPORT_STATUS[pr.status]?.label || pr.status)}</span>
          </div>`).join('')}</div>` : ''}
        ${info.reported_rides.length ? `<div class="mt-3"><div class="label">Their rides</div>
          ${info.reported_rides.slice(0, 5).map((rd) => `<div class="list-row">
            <span class="small">${esc(rd.route)}<span class="tiny muted"> · ${dateOnly(rd.depart_date)}</span></span>
            <span class="badge ${RIDE_STATUS_CLS[rd.status] || ''}">${esc(RIDE_STATUS_LABELS[rd.status] || rd.status)}</span>
          </div>`).join('')}</div>` : ''}
      </div>` : ''}

      ${r.conversation_id ? `
      <div class="card">
        <div class="card-head"><h3>Reported conversation</h3>
          <span class="badge badge-warn">Private</span></div>
        <p class="small muted">Message content is private by default. Opening it here is recorded
        in the admin action log against your name.</p>
        <button class="btn btn-secondary btn-block" id="viewMessages">Open messages for this report</button>
        <div id="messageLog" class="mt-3"></div>
      </div>` : ''}

      <div class="card">
        <div class="card-head"><h3>Actions</h3></div>
        <div class="stack-sm">
          ${r.status !== 'reviewing' ? '<button class="btn btn-secondary btn-block" data-set="reviewing">Mark under review</button>' : ''}
          <button class="btn btn-ok btn-block" data-set="resolved">Resolve</button>
          <button class="btn btn-secondary btn-block" data-set="dismissed">Dismiss</button>
          ${target && !target.is_suspended
            ? '<button class="btn btn-danger btn-block" data-suspend>Suspend this member</button>' : ''}
        </div>
        <p class="tiny muted mt-2 mb-0">A report on its own never suspends anyone — that is a
        separate, confirmed decision.</p>
      </div>`);

    d.el.querySelectorAll('[data-open-user]').forEach((b) =>
      b.addEventListener('click', () => { d.close(); openUser(b.dataset.openUser); }));

    d.el.querySelector('#viewMessages')?.addEventListener('click', async (e) => {
      await withBusy(e.currentTarget, 'Opening…', async () => {
        try {
          const rows = await api.conversationMessages(r.id);
          $('#messageLog').innerHTML = rows.length ? `
            <div class="card" style="background:var(--surface-2);max-height:340px;overflow:auto">
              ${rows.map((m) => `
                <div class="list-row" style="align-items:flex-start">
                  <div style="min-width:0">
                    <div class="tiny muted">${esc(m.sender_name)}${m.is_reporter ? ' (reporter)' : ''}
                      · ${esc(relativeTime(m.created_at))}</div>
                    <div class="small" style="white-space:pre-wrap">${esc(m.body)}</div>
                  </div>
                </div>`).join('')}
            </div>
            <p class="tiny muted mt-2 mb-0">This view was written to the admin action log.</p>`
            : '<p class="small muted mb-0">No messages in this conversation.</p>';
          e.currentTarget.remove();
        } catch (err) { toastError(err); }
      });
    });

    d.el.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => {
      const status = b.dataset.set;
      modal({
        title: `Mark report ${REPORT_STATUS[status].label.toLowerCase()}`,
        body: `<label class="field" style="margin:0"><span>Internal note (optional)</span>
          <textarea id="note" maxlength="1000" placeholder="What did you do about it?"></textarea></label>`,
        actions: [
          { label: 'Cancel', onClick: (_, close) => close() },
          { label: 'Save', cls: 'btn-primary', onClick: async (root, close) => {
              try {
                await api.resolveReport(r.id, status, root.querySelector('#note').value);
                close(); d.close(); toastOk('Report updated'); route();
              } catch (err) { toastError(err); }
            } },
        ],
      });
    }));

    d.el.querySelector('[data-suspend]')?.addEventListener('click', () =>
      suspendDialog(target, true, d));
  } catch (err) {
    setDrawerBody(d, errorState(err, 'drawerRetry'));
    d.el.querySelector('#drawerRetry')?.addEventListener('click', () => { d.close(); openReport(id); });
  }
}

/* ========================================================== ANALYTICS ==== */
async function renderAnalytics() {
  await section('Loading analytics…', async () => {
    const a = await api.analytics(30);
    const series = a.series || [];
    const totalEvents = series.reduce((n, d) =>
      n + d.users + d.rides + d.completed + d.cancelled + d.reports, 0);

    const metric = (label, value, note) => `
      <div class="kpi"><span class="kpi-label">${esc(label)}</span>
        <span class="kpi-value">${value}</span>
        <span class="kpi-note">${esc(note)}</span></div>`;

    const pct = a.completion_rate;
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    view.innerHTML = `
      <div class="kpi-grid mb-4">
        ${metric('Ride completion rate', pct == null ? '—' : pct + '%',
                 pct == null ? 'no finished rides yet' : `${num(a.totals.completed)} of ${num(a.totals.finished)} finished rides`)}
        ${metric('Avg riders per ride', a.avg_riders_per_ride ?? '—',
                 a.avg_riders_per_ride == null ? 'no rides yet' : 'seats filled on average')}
        ${metric('Avg seats available', a.avg_seats_available ?? '—',
                 a.avg_seats_available == null ? 'no rides yet' : 'still free per ride')}
        ${metric('Seats offered', num(a.totals.seats_offered),
                 `${num(a.totals.seats_taken)} taken all time`)}
      </div>

      <section class="admin-section" style="margin-top:0">
        <div class="admin-section-head"><h2>Last 30 days</h2></div>
        <div class="chart-card">
          ${totalEvents === 0 ? notEnoughData() : `
            ${lineChart(series, [
              { key: 'users',  label: 'New members', color: 'var(--navy-700)', fill: true },
              { key: 'rides',  label: 'Rides posted', color: 'var(--blue-500)', fill: true },
            ])}
            <div class="chart-legend">
              <span><span class="chart-swatch" style="background:var(--navy-700)"></span>New members</span>
              <span><span class="chart-swatch" style="background:var(--blue-500)"></span>Rides posted</span>
            </div>`}
        </div>
      </section>

      <section class="admin-section">
        <div class="admin-section-head"><h2>Ride outcomes</h2></div>
        <div class="chart-card">
          ${a.totals.finished === 0 ? notEnoughData('Not enough data yet — no rides have finished') : `
            ${lineChart(series, [
              { key: 'completed', label: 'Completed', color: 'var(--ok)', fill: true },
              { key: 'cancelled', label: 'Cancelled', color: 'var(--danger)' },
            ])}
            <div class="chart-legend">
              <span><span class="chart-swatch" style="background:var(--ok)"></span>Completed</span>
              <span><span class="chart-swatch" style="background:var(--danger)"></span>Cancelled</span>
            </div>`}
        </div>
      </section>

      <section class="admin-section">
        <div class="admin-section-head"><h2>Reports over time</h2></div>
        <div class="chart-card">
          ${series.every((d) => !d.reports) ? notEnoughData('Not enough data yet — no reports filed') : `
            ${lineChart(series, [{ key: 'reports', label: 'Reports', color: 'var(--warn)', fill: true }])}
            <div class="chart-legend"><span><span class="chart-swatch" style="background:var(--warn)"></span>Reports filed</span></div>`}
        </div>
      </section>

      <div class="grid grid-2 admin-section">
        <div class="chart-card">
          <h3 style="font-size:1rem">Busiest departure times</h3>
          ${(a.busiest_hours || []).length
            ? barChart(a.busiest_hours.map((x) => ({ h: x.hour + ':00', rides: x.rides })),
                       { labelKey: 'h', valueKey: 'rides' })
            : notEnoughData()}
        </div>
        <div class="chart-card">
          <h3 style="font-size:1rem">Busiest days</h3>
          ${(a.busiest_days || []).length
            ? barChart(a.busiest_days.map((x) => ({ d: dows[x.dow], rides: x.rides })),
                       { labelKey: 'd', valueKey: 'rides' })
            : notEnoughData()}
        </div>
      </div>

      <section class="admin-section">
        <div class="admin-section-head"><h2>Most active routes</h2></div>
        <div class="card">
          ${(a.top_routes || []).length ? a.top_routes.map((r) => `
            <div class="list-row">
              <span class="small strong">${esc(r.route)}</span>
              <span class="row" style="gap:8px">
                <span class="badge">${r.rides} ride${r.rides === 1 ? '' : 's'}</span>
                <span class="badge badge-quiet">${r.seats_filled} seats filled</span>
              </span>
            </div>`).join('') : notEnoughData()}
        </div>
      </section>`;
  });
}

/* =========================================================== SETTINGS ==== */
async function renderSettings() {
  await section('Loading settings…', async () => {
    const log = await api.actionLog(100);

    const tone = (action) =>
      action.startsWith('user.suspended') || action.startsWith('ride.cancelled') ? 'danger'
      : action.startsWith('verification.approved') || action.startsWith('report.resolved') ? 'ok'
      : action.startsWith('role.') ? 'warn' : '';

    view.innerHTML = `
      <div class="card mb-4">
        <div class="card-head"><h3>Your admin account</h3></div>
        <div class="row" style="gap:12px">
          ${avatarEl(me, '')}
          <div>
            <div class="strong">${esc(me.full_name)}</div>
            <div class="tiny muted">${esc(session.user.email)} · role: ${esc(me.role || 'admin')}</div>
          </div>
        </div>
        <p class="tiny muted mt-3 mb-0">Your role comes from the database. It is a generated
        column derived from <span class="mono">is_admin</span>, so nobody — including you —
        can write to it directly.</p>
      </div>

      <div class="card mb-4">
        <div class="card-head"><h3>Maintenance</h3></div>
        <p class="small muted">Rides close themselves five minutes after departure via a scheduled
        job. Run it now if you want to see the effect immediately.</p>
        <button class="btn btn-secondary" id="runLifecycle">Run ride lifecycle now</button>
        <div id="lifecycleOut" class="mt-2"></div>
      </div>

      <section class="admin-section" style="margin-top:0">
        <div class="admin-section-head">
          <h2>Admin action log</h2>
          <span class="small muted">${log.length} most recent</span>
        </div>
        <div class="card">
          ${log.length ? log.map((l) => `
            <div class="log-row">
              <span class="log-dot ${tone(l.action)}"></span>
              <div style="min-width:0">
                <div class="small"><span class="strong">${esc(l.action)}</span>
                  ${l.target_label ? `<span class="muted"> · ${esc(l.target_label)}</span>` : ''}</div>
                <div class="tiny muted">by ${esc(l.admin_name)}${
                  l.details && Object.keys(l.details).length
                    ? ' · ' + esc(Object.entries(l.details)
                        .filter(([, v]) => v !== null && v !== '' && v !== 0)
                        .map(([k, v]) => `${k}: ${v}`).join(', ')) : ''}</div>
              </div>
              <div class="tiny muted" style="text-align:right">${esc(relativeTime(l.created_at))}</div>
            </div>`).join('')
            : '<p class="small muted mb-0">No admin actions recorded yet.</p>'}
        </div>
      </section>`;

    $('#runLifecycle').addEventListener('click', async (e) => {
      await withBusy(e.currentTarget, 'Running…', async () => {
        try {
          const res = await api.runRideLifecycle();
          $('#lifecycleOut').innerHTML = `<div class="alert alert-ok mb-0">
            Closed ${res.listings_closed} listing(s), completed ${res.rides_completed} ride(s),
            sent ${res.notifications_sent} notification(s).</div>`;
        } catch (err) { toastError(err); }
      });
    });
  });
}

/* ============================================================== start ==== */
if (!location.hash) location.replace('#dashboard');
await route();
refreshCounts();
