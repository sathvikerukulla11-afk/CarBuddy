/**
 * Messages: the conversation list, and the chat view.
 *
 * ?c=<conversation id> opens a conversation; no parameter shows the list.
 *
 * Access is decided by Postgres. Every call here is refused for a non-member,
 * and the realtime subscription respects the same Row Level Security, so a
 * client that subscribes to someone else's conversation receives nothing.
 */
import {
  $, esc, icon, qs, requireAuth, mountChrome, modal,
  toastOk, toastError, readableError, avatarEl, emptyState, loadingState, errorState,
} from './ui.js';
import { supabase } from './client.js';
import {
  myConversations, conversationDetail, conversationMessages, sendMessage,
  markConversationRead, reportConversation, subscribeToConversation,
  REPORT_CONVERSATION_REASONS,
} from './messages-api.js';
import { whenLine, relativeTime } from './format.js';
import { RIDE_STATUS_LABELS } from './constants.js';

await mountChrome({ active: 'Messages' });
const session = await requireAuth();
if (!session) throw new Error('redirecting');
const me = session.user.id;

const page = $('#page');
let channel = null;

/* leaving the page should not leave a socket open */
window.addEventListener('beforeunload', () => { if (channel) supabase.removeChannel(channel); });

const convId = qs('c');
if (convId) openChat(convId); else openList();

/* ===================================================== conversation list == */
async function openList() {
  page.innerHTML = loadingState('Loading your conversations…', 0)
                 + '<div class="skeleton" style="height:180px"></div>';
  let convs;
  try {
    convs = await myConversations();
  } catch (err) {
    page.innerHTML = errorState(err, 'retryConvs');
    $('#retryConvs').addEventListener('click', openList);
    return;
  }

  if (!convs.length) {
    page.innerHTML = `
      <h1 style="font-size:clamp(1.7rem,3.4vw,2.2rem)">Messages</h1>
      ${emptyState('💬', 'No messages yet',
        "When you join a ride, you'll be able to message the people you're riding with.",
        `<div class="row mt-3" style="justify-content:center">
           <a class="btn btn-primary" href="find-ride.html">Find a Ride</a>
           <a class="btn btn-secondary" href="post-ride.html">Post a Ride</a></div>`)}`;
    return;
  }

  page.innerHTML = `
    <div class="row-between mb-4">
      <div>
        <h1 style="font-size:clamp(1.7rem,3.4vw,2.2rem);margin:0">Messages</h1>
        <p class="lede mb-0">Conversations for the rides you're sharing.</p>
      </div>
    </div>
    <div class="conv-list">
      ${convs.map((c) => `
        <a class="conv-card ${c.unread ? 'unread' : ''}" href="messages.html?c=${esc(c.id)}">
          <span class="avatar">${esc(initialsOf(c.other_names))}</span>
          <span style="min-width:0">
            <span class="conv-name">${esc(c.other_names)}${
              c.other_count > 1 ? ` <span class="tiny muted">+${c.other_count - 1} more</span>` : ''}</span>
            <span class="conv-route">${esc(c.origin_label)} → ${esc(c.destination_label)} ·
              ${esc(whenLine(c.depart_date, c.depart_time))}${
                c.ride_status !== 'upcoming' ? ` · ${esc(RIDE_STATUS_LABELS[c.ride_status] || c.ride_status)}` : ''}</span>
            <span class="conv-last">${c.last_message
              ? esc((c.last_sender ? c.last_sender.split(' ')[0] + ': ' : '') + c.last_message)
              : '<span class="muted">No messages yet — say hello</span>'}</span>
          </span>
          <span class="conv-meta">
            <span class="conv-time">${c.last_message_at ? esc(relativeTime(c.last_message_at)) : ''}</span>
            ${c.unread ? `<span class="unread-pill">${c.unread}</span>` : ''}
          </span>
        </a>`).join('')}
    </div>`;
}

const initialsOf = (names) => String(names || '?').trim().split(/[\s,]+/).slice(0, 2)
  .map((w) => w[0]).join('').toUpperCase() || '?';

/* ================================================================= chat === */
async function openChat(id) {
  page.innerHTML = loadingState('Opening conversation…', 0);

  let info, msgs;
  try {
    [info, msgs] = await Promise.all([conversationDetail(id), conversationMessages(id)]);
  } catch (err) {
    page.innerHTML = `
      ${backToList()}
      ${errorState(err, 'retryChat')}`;
    $('#retryChat').addEventListener('click', () => openChat(id));
    return;
  }

  const ride = info.ride;
  const others = (info.members || []).filter((m) => !m.is_me);
  const title = others.length === 1 ? others[0].full_name
              : others.length ? `${others.length} people on this ride` : 'Just you so far';
  const rideOver = ride.status === 'cancelled' || ride.status === 'completed';
  const archived = info.status === 'archived';
  const readOnly = archived;

  page.innerHTML = `
    <div class="chat">
      <header class="chat-head">
        <a class="btn btn-ghost btn-sm" href="messages.html" aria-label="Back to messages">${icon('back')}</a>
        ${others.length === 1 ? avatarEl(others[0], 'avatar-sm') : ''}
        <div class="chat-head-main">
          <div class="chat-title">${esc(title)}</div>
          <div class="chat-sub">${others.length === 1 && others[0].rating_count
            ? `<span class="stars">★</span> ${Number(others[0].rating_avg).toFixed(1)} · `
            : ''}${esc(others.map((o) => o.full_name).join(', ') || 'Nobody else yet')}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="reportConv" title="Report this conversation">Report</button>
      </header>

      <div class="chat-context">
        <span style="min-width:0">
          <strong>${esc(ride.origin_label)} → ${esc(ride.destination_label)}</strong>
          · ${esc(whenLine(ride.depart_date, ride.depart_time))}
          · ${ride.seats_remaining} seat${ride.seats_remaining === 1 ? '' : 's'} free
        </span>
        <a class="btn btn-secondary btn-sm" href="ride.html?id=${esc(info.ride_id)}&from=messages">View ride</a>
      </div>

      ${ride.status === 'cancelled'
        ? '<div class="chat-banner">This ride was cancelled. The conversation stays here so you can sort things out.</div>' : ''}
      ${ride.status === 'completed' && !archived
        ? '<div class="chat-banner">This ride is finished.</div>' : ''}
      ${archived ? '<div class="chat-banner">This conversation is archived and is now read-only.</div>' : ''}

      <div class="chat-scroll" id="scroll">${renderMessages(msgs)}</div>

      ${readOnly ? '' : `
      <form class="chat-compose" id="composer">
        <textarea id="body" rows="1" maxlength="2000" placeholder="Type a message…"
                  aria-label="Message"></textarea>
        <button class="btn btn-primary" id="sendBtn" type="submit">Send</button>
      </form>`}
    </div>`;

  scrollToEnd();
  markConversationRead(id).catch(() => {});
  refreshNavBadge();

  /* ---- live updates ------------------------------------------------- */
  if (channel) supabase.removeChannel(channel);
  channel = subscribeToConversation(id, async (row) => {
    if ($(`[data-msg="${row.id}"]`)) return;             // already on screen
    appendMessage({
      id: row.id, sender_id: row.sender_id, body: row.body,
      created_at: row.created_at, is_mine: row.sender_id === me,
      sender_name: others.find((o) => o.id === row.sender_id)?.full_name || 'They',
    });
    markConversationRead(id).catch(() => {});
    refreshNavBadge();
  });

  /* ---- composing ---------------------------------------------------- */
  const form = $('#composer');
  if (form) {
    const box = $('#body');
    box.addEventListener('input', () => {
      box.style.height = 'auto';
      box.style.height = Math.min(box.scrollHeight, 140) + 'px';
    });
    // Enter sends, Shift+Enter makes a new line
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); send(id, box); });
  }

  $('#reportConv').addEventListener('click', () => reportDialog(id));
}

function backToList() {
  return `<a class="back-link" href="messages.html">${icon('back')} Back to messages</a>`;
}

/* ---- rendering ------------------------------------------------------- */
function renderMessages(msgs) {
  if (!msgs.length) {
    return `<div class="chat-empty">No messages yet.<br>Say hello and agree where to meet.</div>`;
  }
  let lastDay = '';
  return msgs.map((m) => {
    const day = new Date(m.created_at).toDateString();
    const sep = day !== lastDay
      ? `<div class="msg-day">${esc(friendlyDay(m.created_at))}</div>` : '';
    lastDay = day;
    return sep + bubble(m);
  }).join('');
}

function bubble(m) {
  const time = new Date(m.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `
    <div class="msg-row ${m.is_mine ? 'mine' : ''}" data-msg="${esc(m.id)}">
      <div style="min-width:0">
        ${m.is_mine ? '' : `<div class="msg-who">${esc(m.sender_name)}</div>`}
        <div class="bubble">${esc(m.body)}</div>
        <div class="msg-time">${esc(time)}</div>
      </div>
    </div>`;
}

function friendlyDay(iso) {
  const d = new Date(iso), today = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const yest = new Date(today); yest.setDate(today.getDate() - 1);
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

function appendMessage(m) {
  const scroll = $('#scroll');
  if (!scroll) return;
  const empty = scroll.querySelector('.chat-empty');
  if (empty) empty.remove();
  const wasNearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120;
  scroll.insertAdjacentHTML('beforeend', bubble(m));
  if (wasNearBottom || m.is_mine) scrollToEnd();
}

function scrollToEnd() {
  const s = $('#scroll');
  if (s) s.scrollTop = s.scrollHeight;
}

/* ---- sending --------------------------------------------------------- */
async function send(conversationId, box) {
  const body = box.value.trim();
  if (!body) return;                                   // never send an empty message

  const btn = $('#sendBtn');
  btn.disabled = true;
  const original = box.value;
  box.value = '';
  box.style.height = 'auto';

  try {
    const row = await sendMessage(conversationId, body);
    if (row && !$(`[data-msg="${row.id}"]`)) {
      appendMessage({ ...row, is_mine: true, sender_name: 'You' });
    }
    refreshNavBadge();
  } catch (err) {
    box.value = original;                              // give them their words back
    const scroll = $('#scroll');
    if (scroll) {
      scroll.insertAdjacentHTML('beforeend', `
        <div class="msg-row mine" data-retry>
          <div>
            <div class="bubble msg-failed">${esc(body)}</div>
            <div class="msg-time" style="color:var(--danger)">
              ${esc(readableError(err))} · <button class="btn btn-ghost btn-sm" data-retry-send>Retry</button>
            </div>
          </div>
        </div>`);
      scrollToEnd();
      scroll.querySelector('[data-retry-send]')?.addEventListener('click', (e) => {
        e.currentTarget.closest('[data-retry]').remove();
        box.value = body;
        send(conversationId, box);
      });
    }
    toastError('Message couldn\'t be sent. Try again.');
  } finally {
    btn.disabled = false;
    box.focus();
  }
}

/* ---- reporting -------------------------------------------------------- */
function reportDialog(conversationId) {
  modal({
    title: 'Report this conversation',
    body: `
      <label class="field"><span>What's wrong?</span>
        <select id="rCat">${REPORT_CONVERSATION_REASONS
          .map((r) => `<option value="${r.value}">${esc(r.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Tell us what happened</span>
        <textarea id="rDetails" maxlength="2000"
          placeholder="Include what was said and when, if you can."></textarea></label>
      <p class="tiny muted mb-0">This goes to our moderation team. The conversation stays
      available to you, and nothing is deleted. If anyone is in immediate danger, contact
      your local emergency services first.</p>`,
    actions: [
      { label: 'Cancel', onClick: (_, close) => close() },
      { label: 'Send report', cls: 'btn-danger', onClick: async (root, close) => {
          const details = root.querySelector('#rDetails').value.trim();
          if (details.length < 5) { toastError('Please describe what happened.'); return; }
          try {
            await reportConversation(conversationId, root.querySelector('#rCat').value, details);
            close();
            toastOk('Report sent — thank you. Our moderators will look at it.');
          } catch (err) { toastError(err); }
        } },
    ],
  });
}

/* keeps the "Messages" badge in the navbar in step */
async function refreshNavBadge() {
  try {
    const { unreadMessageCount } = await import('./messages-api.js');
    const n = await unreadMessageCount();
    const el = document.querySelector('[data-msg-count]');
    if (!el) return;
    el.textContent = n > 9 ? '9+' : String(n);
    el.classList.toggle('hidden', !n);
  } catch { /* the badge is cosmetic */ }
}
