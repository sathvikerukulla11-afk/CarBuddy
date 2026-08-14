import {
  mountChrome, requireAuth, $, esc, emptyState, toastOk, toastError, loadingState, errorState,
} from './ui.js';
import { listNotifications, markRead } from './notifications.js';
import { relativeTime } from './format.js';

await mountChrome();
if (!(await requireAuth())) throw new Error('redirecting');

const ICONS = {
  request_received: '📥', request_accepted: '✅', request_rejected: '❌',
  guardian_approval_needed: '👪', guardian_approved: '👍', guardian_denied: '🚫',
  guardian_linked: '🔗', ride_cancelled: '⚠️', ride_completed: '🏁', ride_confirmed: '✅',
  rider_left: '↩️', removed_from_ride: '⚠️', new_rating: '⭐',
  ride_departed: '🕓', request_expired: '🕓',
  verification_update: '✓', group_join_request: '👥', group_approved: '👥', ride_removed: '⚠️',
};

const linkFor = (n) => {
  if (n.type === 'guardian_approval_needed') return 'guardian.html';
  if (n.ride_id) return `ride.html?id=${n.ride_id}`;
  if (n.type === 'request_received') return 'my-rides.html?tab=requests';
  return 'my-rides.html';
};

async function render() {
  const list = $('#list');
  list.innerHTML = loadingState('Loading notifications…', 0);
  try {
    const items = await listNotifications();
    if (!items.length) {
      list.innerHTML = emptyState('🔔', 'Nothing yet',
        'Ride requests, approvals, cancellations, and ratings all show up here.');
      return;
    }
    list.innerHTML = `<div class="stack-sm">${items.map((n) => `
      <a class="card card-hover" href="${linkFor(n)}"
         style="display:block;text-decoration:none;color:inherit;${n.read_at ? 'opacity:.7' : 'border-left:3px solid var(--brand-600)'}">
        <div class="row" style="gap:.7rem;align-items:flex-start">
          <span style="font-size:1.3rem">${ICONS[n.type] || '🔔'}</span>
          <div style="flex:1;min-width:0">
            <div class="strong small">${esc(n.title)}</div>
            ${n.body ? `<div class="small muted">${esc(n.body)}</div>` : ''}
            <div class="tiny muted mt-1">${esc(relativeTime(n.created_at))}</div>
          </div>
          ${n.read_at ? '' : '<span class="badge badge-brand">New</span>'}
        </div>
      </a>`).join('')}</div>`;
  } catch (err) {
    toastError(err);
    list.innerHTML = errorState(err, 'retryNotifs');
    $('#retryNotifs').addEventListener('click', render);
  }
}

$('#markAll').addEventListener('click', async () => {
  try { await markRead(); toastOk('All marked read'); render(); }
  catch (err) { toastError(err); }
});

await render();
// Opening the page counts as reading them.
markRead().catch(() => {});
