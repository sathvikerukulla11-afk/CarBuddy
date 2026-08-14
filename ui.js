/**
 * Web-only UI helpers: navigation chrome, toasts, modals, ride cards.
 * Nothing in here is imported by the data layer, so the mobile app never sees it.
 */
import { supabase, isConfigured, readableError } from './client.js';
import { getMyProfile } from './profiles.js';
import { signOut } from './auth.js';
import { unreadCount, subscribe } from './notifications.js';
import { seatState, initials, whenLine, money } from './format.js';
import { RIDE_STATUS_LABELS } from './constants.js';

export { readableError, isConfigured };

/* ------------------------------------------------------------- escaping -- */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------------------------------------------------------- icons -- */
/* Inline so there is no icon-font request and they inherit currentColor. */
const I = {
  check:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 10.5 4 4 8-9"/></svg>',
  shield:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.5 4 5v4.5c0 3.6 2.5 6.8 6 8 3.5-1.2 6-4.4 6-8V5l-6-2.5Z"/><path d="m7.5 10 1.8 1.8 3.4-3.6"/></svg>',
  users:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="7" r="2.75"/><path d="M2.5 16c0-2.5 2.2-4.25 5-4.25S12.5 13.5 12.5 16"/><path d="M13.5 4.6a2.6 2.6 0 0 1 0 4.9M15 11.9c1.6.5 2.7 1.7 2.7 3.4"/></svg>',
  family:  '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.5" cy="6" r="2.4"/><circle cx="14" cy="7.5" r="1.9"/><path d="M2.5 15.5c0-2.2 1.8-3.8 4-3.8s4 1.6 4 3.8M12 15.5c0-1.7 1.2-2.9 2.7-2.9s2.8 1.2 2.8 2.9"/></svg>',
  pin:     '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17.5s5.5-4.9 5.5-9a5.5 5.5 0 1 0-11 0c0 4.1 5.5 9 5.5 9Z"/><circle cx="10" cy="8.5" r="2"/></svg>',
  seat:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 3.5h9l1 7h-11l1-7Z"/><path d="M4 10.5h12l.5 4H3.5l.5-4Z"/><path d="M6 14.5v2M14 14.5v2"/></svg>',
  car:     '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5h14M4.5 12.5V15h2v-2.5M13.5 12.5V15h2v-2.5"/><path d="M4 12.5 5.4 7.6A2 2 0 0 1 7.3 6h5.4a2 2 0 0 1 1.9 1.6L16 12.5"/><circle cx="6.5" cy="10.2" r=".6" fill="currentColor" stroke="none"/><circle cx="13.5" cy="10.2" r=".6" fill="currentColor" stroke="none"/></svg>',
  bell:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3.3-1 4.5-1 4.5h11s-1-1.2-1-4.5A4.5 4.5 0 0 0 10 3Z"/><path d="M8.6 15a1.6 1.6 0 0 0 2.8 0"/></svg>',
  menu:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 6h13M3.5 10h13M3.5 14h13"/></svg>',
  close:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg>',
  arrow:   '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M4 10h11M10.5 5.5 15 10l-4.5 4.5"/></svg>',
  back:    '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><path d="M16 10H5M9.5 5.5 5 10l4.5 4.5"/></svg>',
};
export const icon = (name, size = 18) =>
  (I[name] || '').replace('<svg ', `<svg width="${size}" height="${size}" aria-hidden="true" `);

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
      <div class="wrap" style="padding:96px 24px;max-width:520px;text-align:center">
        <div class="empty-icon" style="margin-inline:auto">🔒</div>
        <h1 style="font-size:1.6rem">Administrators only</h1>
        <p class="muted">This area is restricted. Every admin action is also blocked
        at the database level, so there is nothing to see here.</p>
        <a class="btn btn-primary mt-3" href="index.html">Back to home</a>
      </div>`;
    return null;
  }
  return { session, profile };
}

/* ----------------------------------------------------------------- nav --- */
/**
 * The global navigation bar, rendered from one place so it can never drift
 * between pages.
 *
 *   signed in : Logo | Home · Find a Ride · Post a Ride · Dashboard · My Rides
 *                                              …        🔔  [avatar Name ▾]
 *   signed out: Logo | Home · Find a Ride · Safety       …    Log in  Sign up
 *
 * Secondary destinations (Profile, Safety, Groups, Notifications, Parent /
 * Guardian, Admin) live in the avatar dropdown. Every entry is a real file.
 */
const NAV_SIGNED_IN = [
  { href: 'index.html',     label: 'Home' },
  { href: 'find-ride.html', label: 'Find a Ride' },
  { href: 'post-ride.html', label: 'Post a Ride' },
  { href: 'dashboard.html', label: 'Dashboard' },
  { href: 'my-rides.html',  label: 'My Rides' },
];

const NAV_SIGNED_OUT = [
  { href: 'index.html',     label: 'Home' },
  { href: 'find-ride.html', label: 'Find a Ride' },
  { href: 'safety.html',    label: 'Safety' },
];

const MENU_ITEMS = [
  { href: 'profile.html',       label: 'Your profile',      ico: '👤' },
  { href: 'groups.html',        label: 'Trusted groups',    ico: '👥' },
  { href: 'notifications.html', label: 'Notifications',     ico: '🔔' },
  { href: 'guardian.html',      label: 'Parent / Guardian',  ico: '👪' },
  { href: 'safety.html',        label: 'Safety Center',     ico: '🛡️' },
];

export async function mountChrome({ active = '' } = {}) {
  const session = await currentSession();
  const profile = session ? await currentProfile() : null;
  const here = location.pathname.split('/').pop() || 'index.html';

  const isActive = (i) => i.href === here || i.label === active;
  const link = (i) =>
    `<a href="${i.href}"${isActive(i) ? ' class="active" aria-current="page"' : ''}>${i.label}</a>`;

  const primary = session ? NAV_SIGNED_IN : NAV_SIGNED_OUT;
  const menu = session
    ? [...MENU_ITEMS, ...(profile?.is_admin ? [{ href: 'admin.html', label: 'Admin', ico: '⚙️' }] : [])]
    : [];

  const unread = session ? await unreadCount().catch(() => 0) : 0;
  const name = profile?.full_name || session?.user?.email?.split('@')[0] || 'My account';
  const avatar = (cls) => profile?.avatar_url
    ? `<img src="${esc(profile.avatar_url)}" alt="" class="avatar ${cls}">`
    : `<span class="avatar ${cls}">${esc(initials(name))}</span>`;

  const authArea = session ? `
    <a class="btn btn-ghost btn-sm bell" href="notifications.html"
       aria-label="Notifications${unread ? `, ${unread} unread` : ''}" title="Notifications">
      ${icon('bell', 19)}${unread ? `<span class="bell-dot" id="bellCount">${unread > 9 ? '9+' : unread}</span>` : ''}
    </a>
    <button type="button" class="nav-user" id="navUserBtn" aria-expanded="false" aria-haspopup="true">
      ${avatar('avatar-sm')}
      <span class="nav-user-name">${esc(name)}</span>
      <span class="nav-user-caret" aria-hidden="true">▼</span>
    </button>` : `
    <a class="btn btn-ghost btn-sm" href="login.html">Log in</a>
    <a class="btn btn-primary btn-sm" href="signup.html">Sign up</a>`;

  const nav = document.getElementById('nav');
  if (nav) {
    nav.outerHTML = `
      <header class="nav">
        <div class="nav-inner">
          <a class="brand" href="index.html" aria-label="CarBuddy home">
            <span class="brand-mark" aria-hidden="true">${icon('car', 17)}</span> CarBuddy
          </a>
          <nav class="nav-links" aria-label="Main">${primary.map(link).join('')}</nav>
          <div class="nav-actions">${authArea}</div>
          <button type="button" class="nav-toggle" id="navToggle" aria-label="Open menu"
                  aria-expanded="false" aria-controls="navDrawer">${icon('menu', 18)}</button>
        </div>

        ${session ? `
        <div class="nav-menu" id="navMenu" role="menu" aria-labelledby="navUserBtn">
          <div class="nav-menu-head">
            <div class="strong" style="font-size:.92rem">${esc(name)}</div>
            <div class="tiny muted">${esc(session.user.email || '')}</div>
          </div>
          ${menu.map((i) => `<a role="menuitem" href="${i.href}">
             <span class="nav-menu-ico" aria-hidden="true">${i.ico}</span>${i.label}</a>`).join('')}
          <hr>
          <button type="button" role="menuitem" class="danger" id="logoutBtn">
            <span class="nav-menu-ico" aria-hidden="true">↪</span>Log out</button>
        </div>` : ''}

        <div class="nav-drawer" id="navDrawer">
          ${session ? `
            <div class="nav-drawer-user">
              ${avatar('avatar-lg')}
              <div><div class="strong">${esc(name)}</div>
                <div class="tiny muted">${esc(session.user.email || '')}</div></div>
            </div>` : ''}
          ${primary.map(link).join('')}
          ${menu.map(link).join('')}
          ${session
            ? '<button type="button" class="nav-drawer-logout" id="logoutBtnMobile">Log out</button>'
            : '<a href="login.html">Log in</a><a href="signup.html">Sign up</a>'}
        </div>
      </header>`;

    /* hamburger -------------------------------------------------------- */
    const toggle = document.getElementById('navToggle');
    const drawer = document.getElementById('navDrawer');
    toggle?.addEventListener('click', () => {
      const open = drawer.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      toggle.innerHTML = icon(open ? 'close' : 'menu', 18);
      document.body.style.overflow = open ? 'hidden' : '';
    });

    /* avatar dropdown --------------------------------------------------- */
    const userBtn = document.getElementById('navUserBtn');
    const menuEl = document.getElementById('navMenu');
    if (userBtn && menuEl) {
      const setOpen = (open) => {
        menuEl.classList.toggle('open', open);
        userBtn.setAttribute('aria-expanded', String(open));
      };
      userBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        setOpen(!menuEl.classList.contains('open'));
      });
      menuEl.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => setOpen(false));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    }

    /* log out — really signs out, then lands on the public home page ---- */
    const doLogout = async (btn) => {
      btn.disabled = true;
      btn.textContent = 'Signing out…';
      try { await signOut(); } catch { /* clearing the local session is what matters */ }
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
            <div class="brand"><span class="brand-mark" aria-hidden="true">${icon('car', 17)}</span> CarBuddy</div>
            <p class="small" style="max-width:34ch;margin-top:16px">
              Sharing journeys people are already making, between neighbours,
              classmates and teammates. Not a taxi service.
            </p>
          </div>
          <div><h4>Rides</h4><div class="footer-links">
            <a href="find-ride.html">Find a Ride</a><a href="post-ride.html">Post a Ride</a>
            <a href="my-rides.html">My Rides</a><a href="groups.html">Trusted Groups</a>
          </div></div>
          <div><h4>Trust &amp; safety</h4><div class="footer-links">
            <a href="safety.html">Safety Center</a><a href="safety.html#rules">Community rules</a>
            <a href="guardian.html">Parent / Guardian</a><a href="safety.html#report">Report a problem</a>
          </div></div>
          <div><h4>Account</h4><div class="footer-links">
            <a href="dashboard.html">Dashboard</a><a href="profile.html">Your profile</a>
            <a href="notifications.html">Notifications</a><a href="login.html">Log in</a>
          </div></div>
        </div>
        <div class="wrap footer-bottom">
          CarBuddy never handles money. Any contribution is agreed and paid directly
          between you and your driver. Riders under 18 need a linked parent or guardian.
        </div>
      </footer>`;
  }

  if (!isConfigured) showConfigWarning();
  if (session?.user?.id) {
    subscribe(session.user.id, (n) => {
      toast(n.title);
      const dot = document.getElementById('bellCount');
      if (dot) dot.textContent = String(Math.min(9, (parseInt(dot.textContent) || 0) + 1)) + '+';
    });
  }
  if (profile?.is_suspended) {
    banner('Your account is suspended, so you cannot post or request rides. Contact support if you think this is a mistake.', 'warn');
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
  el.style.cssText = 'border-radius:0;margin:0;text-align:center;border-inline:0;font-weight:500';
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
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), 260);
  }, 4200);
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
        <button class="btn btn-ghost btn-sm" data-close aria-label="Close">${icon('close', 16)}</button></div>
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
  const label = s.level === 'full' ? 'Ride full' : s.label;
  return `<span class="seats ${s.cls}">${esc(label)}</span>`;
}

export function verifiedBadge(status) {
  if (status === 'verified') return `<span class="badge badge-verified">${icon('check', 12)} Verified</span>`;
  if (status === 'pending')  return '<span class="badge badge-warn">Verification pending</span>';
  return '<span class="badge badge-quiet">Not yet verified</span>';
}

export function avatarEl(profile, cls = '') {
  if (profile?.avatar_url) return `<img class="avatar ${cls}" src="${esc(profile.avatar_url)}" alt="">`;
  return `<span class="avatar ${cls}">${esc(initials(profile?.full_name))}</span>`;
}

export function visibilityBadge(ride) {
  if (ride.visibility === 'group') {
    return `<span class="badge badge-brand">${esc(ride.group?.name || 'Trusted group')}</span>`;
  }
  if (ride.visibility === 'approval') return '<span class="badge badge-quiet">By invite</span>';
  return '<span class="badge badge-quiet">Open to verified members</span>';
}

/** The vertical origin → destination rail used on cards and the ride page. */
export function routeBlock(ride, { subFrom = '', subTo = '' } = {}) {
  return `
    <div class="route">
      <div class="route-rail" aria-hidden="true">
        <span class="route-node"></span>
        <span class="route-line-v"></span>
        <span class="route-node route-node-end"></span>
      </div>
      <div>
        <div class="route-stop">
          <div class="route-place">${esc(ride.origin_label)}</div>
          ${subFrom ? `<div class="route-sub">${esc(subFrom)}</div>` : ''}
        </div>
        <div class="route-stop">
          <div class="route-place">${esc(ride.destination_label)}</div>
          ${subTo ? `<div class="route-sub">${esc(subTo)}</div>` : ''}
        </div>
      </div>
    </div>`;
}

export function rideCard(ride, { href = `ride.html?id=${ride.id}&from=find`, footer = null } = {}) {
  const d = ride.driver || {};
  const full = Number(ride.seats_remaining) <= 0;
  const contribution = Number(ride.contribution_amount) > 0;

  const rating = d.rating_count
    ? `<span class="stars">★</span> <span class="rating-num">${Number(d.rating_avg).toFixed(1)}</span>
       <span class="muted">(${d.rating_count})</span>`
    : '<span class="muted">New member</span>';

  return `
  <article class="card card-hover ride-card">
    <div class="ride-card-body">
      <div class="ride-when">${esc(whenLine(ride.depart_date, ride.depart_time)).replace(' • ', '<span class="dot">•</span>')}</div>
      ${routeBlock(ride)}
      <div class="ride-meta">
        ${seatBadge(ride.seats_remaining)}
        ${ride.status !== 'upcoming'
          ? `<span class="badge badge-warn">${esc(RIDE_STATUS_LABELS[ride.status] || ride.status)}</span>` : ''}
        ${ride.visibility === 'group' ? visibilityBadge(ride) : ''}
      </div>
      ${ride.notes ? `<p class="ride-note">${esc(ride.notes)}</p>` : ''}
    </div>
    <div class="ride-foot">
      <div class="ride-driver">
        ${avatarEl(d, 'avatar-sm')}
        <div style="min-width:0">
          <div class="name">${esc(d.full_name || 'Driver')}</div>
          <div class="meta">${rating}${d.verification_status === 'verified'
            ? ` <span class="badge badge-verified" style="padding:0 .34rem">${icon('check', 10)}</span>` : ''}</div>
        </div>
      </div>
      <span class="spacer"></span>
      ${footer !== null ? footer : `
        <div class="row" style="gap:12px">
          <span class="contribution">${contribution ? esc(money(ride.contribution_amount)) : 'Free'}</span>
          <a class="btn ${full ? 'btn-secondary' : 'btn-primary'} btn-sm" href="${href}">View ride</a>
        </div>`}
    </div>
  </article>`;
}

/* ------------------------------------------------------------- states ---- */
export function emptyState(iconGlyph, title, message, action = '') {
  return `<div class="empty">
    <div class="empty-icon">${iconGlyph}</div>
    <h3>${esc(title)}</h3>
    <p style="max-width:46ch;margin-inline:auto">${esc(message)}</p>${action}</div>`;
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
      <div class="empty-icon">⚠</div>
      <h3>Something went wrong. Please try again.</h3>
      <p style="max-width:46ch;margin-inline:auto">${esc(readableError(err))}</p>
      <button class="btn btn-primary mt-3" id="${esc(retryId)}">Retry</button>
    </div>`;
}

/** Consistent back link. Always points somewhere real. */
export function backLink(href, label) {
  return `<a class="back-link" href="${esc(href)}">${icon('back')} ${esc(label)}</a>`;
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
