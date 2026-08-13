/**
 * Web-only UI helpers: navigation chrome, toasts, modals, ride cards.
 * Nothing in here is imported by /shared, so the mobile app never sees it.
 */
import { supabase, isConfigured, readableError } from './client.js';
import { getMyProfile } from './profiles.js';
import { signOut } from './auth.js';
import { unreadCount, subscribe } from './notifications.js';
import { seatState, initials, whenLine, money, starString } from './format.js';

export { readableError, isConfigured };

/* ------------------------------------------------------------- escaping -- */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------------------------------------------------------- state -- */
let cachedProfile = null;
let cachedSession = null;

export async function currentSession() {
  if (cachedSession !== null) return cachedSession;
  const { data } = await supabase.auth.getSession();
  cachedSession = data.session;
  return cachedSession;
}

export async function currentProfile(force = false) {
  if (cachedProfile && !force) return cachedProfile;
  cachedProfile = await getMyProfile().catch(() => null);
  return cachedProfile;
}

/* ------------------------------------------------------- page protection -- */
/** Redirects to login when signed out. Returns the session when signed in. */
export async function requireAuth() {
  const session = await currentSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname.split('/').pop() + location.search);
    location.replace(`login.html?next=${next}`);
    return null;
  }
  return session;
}

/** The admin page also checks this, but Postgres RLS is the real gatekeeper. */
export async function requireAdmin() {
  const session = await requireAuth();
  if (!session) return null;
  const profile = await currentProfile(true);
  if (!profile?.is_admin) {
    document.body.innerHTML = `
      <div class="wrap" style="padding:80px 20px;max-width:520px;text-align:center">
        <div style="font-size:44px">🔒</div>
        <h1>Administrators only</h1>
        <p class="muted">This area is restricted. Every admin action is also blocked
        at the database level, so there is nothing to see here.</p>
        <a class="btn btn-primary" href="index.html">Back to home</a>
      </div>`;
    return null;
  }
  return { session, profile };
}

/* ----------------------------------------------------------------- nav --- */
/**
 * The global navigation bar. Identical on every page, rendered from one place
 * so the two can never drift apart.
 *
 *   signed in : Logo | Home | Find a Ride | Post a Ride | Dashboard | My Rides
 *               | Profile | More ▾            …            🔔  Name  Log out
 *   signed out: Logo | Home | Find a Ride | Safety          …    Log in  Sign up
 *
 * Every entry points at a real file. No dead placeholder anchors.
 */
const NAV_SIGNED_IN = [
  { href: 'index.html',      label: 'Home' },
  { href: 'find-ride.html',  label: 'Find a Ride' },
  { href: 'post-ride.html',  label: 'Post a Ride' },
  { href: 'dashboard.html',  label: 'Dashboard' },
  { href: 'my-rides.html',   label: 'My Rides' },
  { href: 'profile.html',    label: 'Profile' },
];

const NAV_SIGNED_OUT = [
  { href: 'index.html',     label: 'Home' },
  { href: 'find-ride.html', label: 'Find a Ride' },
  { href: 'safety.html',    label: 'Safety' },
];

// Secondary destinations, kept one click away rather than dropped.
const NAV_MORE = [
  { href: 'groups.html',        label: 'Trusted Groups' },
  { href: 'safety.html',        label: 'Safety Center' },
  { href: 'notifications.html', label: 'Notifications' },
  { href: 'guardian.html',      label: 'Parent / Guardian' },
];

export async function mountChrome({ active = '' } = {}) {
  const session = await currentSession();
  const profile = session ? await currentProfile() : null;
  const here = location.pathname.split('/').pop() || 'index.html';

  const isActive = (item) => item.href === here || item.label === active;
  const link = (i) => `<a href="${i.href}"${isActive(i) ? ' class="active" aria-current="page"' : ''}>${i.label}</a>`;

  const primary = (session ? NAV_SIGNED_IN : NAV_SIGNED_OUT);
  const more = session
    ? [...NAV_MORE, ...(profile?.is_admin ? [{ href: 'admin.html', label: 'Admin' }] : [])]
    : [];

  const unread = session ? await unreadCount().catch(() => 0) : 0;
  const name = profile?.full_name || session?.user?.email?.split('@')[0] || 'My account';

  const moreMenu = more.length ? `
    <div class="nav-more">
      <button type="button" class="nav-more-btn" id="navMoreBtn" aria-expanded="false" aria-haspopup="true">
        More <span aria-hidden="true">▾</span>
      </button>
      <div class="nav-dropdown" id="navDropdown" role="menu">
        ${more.map((i) => `<a role="menuitem" href="${i.href}"${isActive(i) ? ' class="active"' : ''}>${i.label}</a>`).join('')}
      </div>
    </div>` : '';

  const authArea = session ? `
    <a class="btn btn-ghost btn-sm bell" href="notifications.html" aria-label="Notifications (${unread} unread)" title="Notifications">
      <span aria-hidden="true">🔔</span>${unread ? `<span class="bell-dot" id="bellCount">${unread > 9 ? '9+' : unread}</span>` : ''}
    </a>
    <a href="profile.html" class="nav-user" title="Your profile">
      ${profile?.avatar_url
        ? `<img src="${esc(profile.avatar_url)}" alt="" class="avatar avatar-sm">`
        : `<span class="avatar avatar-sm">${esc(initials(name))}</span>`}
      <span class="nav-user-name">${esc(name)}</span>
    </a>
    <button type="button" class="btn btn-secondary btn-sm" id="logoutBtn">Log out</button>` : `
    <a class="btn btn-ghost btn-sm" href="login.html">Log in</a>
    <a class="btn btn-primary btn-sm" href="signup.html">Sign up</a>`;

  const nav = document.getElementById('nav');
  if (nav) {
    nav.outerHTML = `
      <header class="nav">
        <div class="nav-inner">
          <a class="brand" href="index.html" aria-label="CarBuddy home">
            <span class="brand-mark" aria-hidden="true">🚗</span> CarBuddy
          </a>
          <nav class="nav-links" aria-label="Main">${primary.map(link).join('')}${moreMenu}</nav>
          <div class="nav-actions">${authArea}</div>
          <button type="button" class="nav-toggle" id="navToggle" aria-label="Open menu"
                  aria-expanded="false" aria-controls="navDrawer">☰</button>
        </div>

        <div class="nav-drawer" id="navDrawer">
          ${session ? `
            <div class="nav-drawer-user">
              ${profile?.avatar_url
                ? `<img src="${esc(profile.avatar_url)}" alt="" class="avatar">`
                : `<span class="avatar">${esc(initials(name))}</span>`}
              <div><div class="strong">${esc(name)}</div>
                <div class="tiny muted">${esc(session.user.email || '')}</div></div>
            </div>` : ''}
          ${primary.map(link).join('')}
          ${more.map(link).join('')}
          ${session
            ? '<button type="button" class="nav-drawer-logout" id="logoutBtnMobile">Log out</button>'
            : '<a href="login.html">Log in</a><a href="signup.html">Sign up</a>'}
        </div>
      </header>`;

    /* hamburger */
    const toggle = document.getElementById('navToggle');
    const drawer = document.getElementById('navDrawer');
    toggle?.addEventListener('click', () => {
      const open = drawer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      toggle.textContent = open ? '✕' : '☰';
    });

    /* "More" dropdown, with click-outside and Escape to close */
    const moreBtn = document.getElementById('navMoreBtn');
    const dropdown = document.getElementById('navDropdown');
    if (moreBtn && dropdown) {
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = dropdown.classList.toggle('open');
        moreBtn.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', () => {
        dropdown.classList.remove('open');
        moreBtn.setAttribute('aria-expanded', 'false');
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          dropdown.classList.remove('open');
          moreBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    /* log out — really signs out, then lands on the public home page */
    const doLogout = async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Signing out…';
      try {
        await signOut();
      } catch {
        /* clearing the local session is what matters; ignore network noise */
      }
      location.href = 'index.html';
    };
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => doLogout(e.currentTarget));
    document.getElementById('logoutBtnMobile')?.addEventListener('click', (e) => doLogout(e.currentTarget));
  }

  const footer = document.getElementById('footer');
  if (footer) {
    footer.outerHTML = `
      <footer class="footer">
        <div class="wrap footer-grid">
          <div>
            <div class="brand" style="color:#fff"><span class="brand-mark">🚗</span> CarBuddy</div>
            <p class="small" style="max-width:34ch;margin-top:.75rem;color:#8ba0b4">
              Community carpooling between people who already share a school, a
              neighbourhood, or a team. Not a taxi service.
            </p>
          </div>
          <div><h4>Product</h4><div class="footer-links">
            <a href="find-ride.html">Find a Ride</a><a href="post-ride.html">Post a Ride</a>
            <a href="my-rides.html">My Rides</a><a href="groups.html">Trusted Groups</a>
          </div></div>
          <div><h4>Safety</h4><div class="footer-links">
            <a href="safety.html">Safety Center</a><a href="safety.html#rules">Community rules</a>
            <a href="guardian.html">Parent / Guardian</a><a href="safety.html#report">Report a problem</a>
          </div></div>
          <div><h4>Account</h4><div class="footer-links">
            <a href="dashboard.html">Dashboard</a><a href="profile.html">Profile</a>
            <a href="notifications.html">Notifications</a><a href="login.html">Log in</a>
          </div></div>
        </div>
        <div class="wrap footer-bottom">
          CarBuddy never processes payments. Any contribution is arranged and paid
          directly between the driver and rider. Riders under 18 need a linked parent or guardian.
        </div>
      </footer>`;
  }

  if (!isConfigured) showConfigWarning();
  if (session?.user?.id) {
    subscribe(session.user.id, (n) => {
      toast(`🔔 ${n.title}`);
      const dot = document.getElementById('bellCount');
      if (dot) dot.textContent = String(Math.min(9, (parseInt(dot.textContent) || 0) + 1)) + '+';
    });
  }
  if (profile?.is_suspended) {
    banner('Your account is suspended. You cannot post or join rides. Contact support if you think this is a mistake.', 'warn');
  }
  return { session, profile };
}

function showConfigWarning() {
  banner(
    'Supabase is not configured yet. Add your project URL and publishable key to <span class="mono">config.js</span> — nothing will load until then.',
    'warn'
  );
}

export function banner(html, kind = 'info') {
  const el = document.createElement('div');
  el.className = `alert alert-${kind}`;
  el.style.cssText = 'border-radius:0;margin:0;text-align:center;font-weight:500';
  el.innerHTML = html;
  document.body.prepend(el);
}

/* --------------------------------------------------------------- toasts -- */
export function toast(message, kind = '') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast ${kind ? 'toast-' + kind : ''}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

export const toastError = (e) => toast(typeof e === 'string' ? e : readableError(e), 'error');
export const toastOk    = (m) => toast(m, 'ok');

/* --------------------------------------------------------------- modals -- */
export function modal({ title, body, actions = [], onOpen }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="card-head"><h3>${esc(title)}</h3>
        <button class="btn btn-ghost btn-sm" data-close aria-label="Close">✕</button></div>
      <div class="modal-body">${body}</div>
      <div class="row mt-3" style="justify-content:flex-end">
        ${actions.map((a, i) => `<button class="btn ${a.cls || 'btn-secondary'}" data-action="${i}">${esc(a.label)}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-close]').addEventListener('click', close);
  actions.forEach((a, i) => {
    backdrop.querySelector(`[data-action="${i}"]`).addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      try { await a.onClick?.(backdrop, close); }
      catch (err) { toastError(err); }
      finally { btn.disabled = false; }
    });
  });
  onOpen?.(backdrop, close);
  return { el: backdrop, close };
}

export function confirmDialog(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    modal({
      title,
      body: `<p class="muted" style="margin:0">${esc(message)}</p>`,
      actions: [
        { label: 'Cancel', cls: 'btn-secondary', onClick: (_, close) => { close(); resolve(false); } },
        { label: confirmLabel, cls: 'btn-primary', onClick: (_, close) => { close(); resolve(true); } },
      ],
    });
  });
}

/* ---------------------------------------------------------- ride pieces -- */
export function seatBadge(remaining) {
  const s = seatState(remaining);
  return `<span class="seats ${s.cls}">${s.icon} ${s.label}</span>`;
}

export function verifiedBadge(status) {
  if (status === 'verified') return '<span class="badge badge-ok">✓ Verified</span>';
  if (status === 'pending')  return '<span class="badge badge-warn">Verification pending</span>';
  return '<span class="badge">Unverified</span>';
}

export function avatarEl(profile, cls = '') {
  if (profile?.avatar_url) {
    return `<img class="avatar ${cls}" src="${esc(profile.avatar_url)}" alt="">`;
  }
  return `<span class="avatar ${cls}">${esc(initials(profile?.full_name))}</span>`;
}

export function visibilityBadge(ride) {
  if (ride.visibility === 'group') {
    return `<span class="badge badge-brand">👥 ${esc(ride.group?.name || 'Trusted group')}</span>`;
  }
  if (ride.visibility === 'approval') {
    return '<span class="badge">🔗 Unlisted — by invite</span>';
  }
  return '<span class="badge badge-info">🌐 Public — verified members</span>';
}

export function rideCard(ride, { href = `ride.html?id=${ride.id}&from=find`, footer = null } = {}) {
  const d = ride.driver || {};
  const full = Number(ride.seats_remaining) <= 0;
  const rating = d.rating_count
    ? `<span class="stars">${starString(d.rating_avg)}</span> <span class="tiny muted">${Number(d.rating_avg).toFixed(1)} (${d.rating_count})</span>`
    : '<span class="tiny muted">No ratings yet</span>';

  return `
  <article class="card card-hover ride-card">
    <div class="route">
      <div class="route-line">
        <span>${esc(ride.origin_label)}</span>
        <span class="route-arrow">→</span>
        <span>${esc(ride.destination_label)}</span>
      </div>
      <div class="route-when">${esc(whenLine(ride.depart_date, ride.depart_time))}</div>
    </div>
    <div class="ride-meta">
      ${seatBadge(ride.seats_remaining)}
      <span class="badge">${esc(money(ride.contribution_amount))}${Number(ride.contribution_amount) > 0 ? ' · in person' : ''}</span>
      ${visibilityBadge(ride)}
      ${ride.status !== 'upcoming' ? `<span class="badge badge-warn">${esc(ride.status)}</span>` : ''}
    </div>
    ${ride.notes ? `<p class="small muted" style="margin:0">${esc(ride.notes).slice(0, 140)}</p>` : ''}
    <div class="ride-foot">
      <div class="ride-driver">
        ${avatarEl(d, 'avatar-sm')}
        <div style="min-width:0">
          <div class="name">${esc(d.full_name || 'Driver')}</div>
          <div class="tiny">${rating}</div>
        </div>
      </div>
      <span class="spacer"></span>
      ${footer !== null ? footer : `<a class="btn ${full ? 'btn-secondary' : 'btn-primary'} btn-sm" href="${href}">
        ${full ? 'View ride' : 'View ride'}</a>`}
    </div>
  </article>`;
}

export function emptyState(icon, title, message, action = '') {
  return `<div class="empty"><div class="empty-icon">${icon}</div>
    <h3 style="color:var(--ink)">${esc(title)}</h3>
    <p style="max-width:44ch;margin-inline:auto">${esc(message)}</p>${action}</div>`;
}

export function skeletons(n = 3) {
  return `<div class="grid grid-3">${'<div class="skeleton"></div>'.repeat(n)}</div>`;
}

/**
 * A visible, labelled loading state. Skeletons alone leave screen-reader users
 * and anyone on a slow connection unsure whether the page has frozen.
 */
export function loadingState(message = 'Loading…', withSkeletons = 0) {
  return `
    <div role="status" aria-live="polite">
      <div class="loading-line"><span class="spinner" aria-hidden="true"></span>${esc(message)}</div>
      ${withSkeletons ? skeletons(withSkeletons) : ''}
    </div>`;
}

/** A failure state that always offers a way forward. */
export function errorState(err, retryId = 'retryBtn') {
  return `
    <div class="empty" role="alert">
      <div class="empty-icon">⚠️</div>
      <h3 style="color:var(--ink)">Something went wrong. Please try again.</h3>
      <p style="max-width:46ch;margin-inline:auto">${esc(readableError(err))}</p>
      <button class="btn btn-primary mt-3" id="${esc(retryId)}">Retry</button>
    </div>`;
}

/** Consistent back link. Always points somewhere real. */
export function backLink(href, label) {
  return `<a class="back-link" href="${esc(href)}"><span aria-hidden="true">←</span> ${esc(label)}</a>`;
}

/** Disables a button while an async action runs. */
export async function withBusy(btn, label, fn) {
  if (!btn) return fn();
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = label || 'Working…';
  try { return await fn(); }
  finally { btn.disabled = false; btn.innerHTML = original; }
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}
