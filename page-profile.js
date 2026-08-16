import {
  mountChrome, requireAuth, currentProfile, $, $$, esc, qs, modal, confirmDialog,
  toastOk, toastError, avatarEl, emptyState,
  loadingState, errorState, backLink,
} from './ui.js';
import {
  getProfile, getMyPrivateProfile, updateMyProfile, updateMyPrivateProfile,
  uploadAvatar, getRatingsFor,
} from './profiles.js';
import { signOut } from './auth.js';
import { blockUser, unblockUser, myBlockList, submitReport } from './safety.js';
import { AGE_CATEGORIES, REPORT_CATEGORIES } from './constants.js';
import { starString, relativeTime } from './format.js';
import { geocode } from './geocode.js';

await mountChrome();
const session = await requireAuth();
if (!session) throw new Error('redirecting');

const me = session.user.id;
const viewId = qs('id');
const isSelf = !viewId || viewId === me;
const page = $('#page');

page.innerHTML = loadingState('Loading profile…', 0) + '<div class="skeleton" style="height:260px"></div>';

if (isSelf) { renderMine(); } else { renderOther(viewId); }

/* ============================================================= own profile */
async function renderMine() {
  let p, priv, ratings, blocks;
  try {
    [p, priv, ratings, blocks] = await Promise.all([
      currentProfile(true), getMyPrivateProfile().catch(() => null),
      getRatingsFor(me).catch(() => []), myBlockList().catch(() => []),
    ]);
  } catch (err) {
    page.innerHTML = errorState(err, 'retryProfile');
    $('#retryProfile').addEventListener('click', renderMine);
    return;
  }
  if (!p) { page.innerHTML = emptyState('⚠️', 'Profile not found', 'Try signing out and in again.'); return; }

  page.innerHTML = `
    <div class="row-between mb-3">
      <h1 style="font-size:1.9rem;margin:0">My profile</h1>
      <button class="btn btn-secondary btn-sm" id="signOut">Sign out</button>
    </div>

    <section class="card card-pad-lg mb-3">
      <div class="profile-header">
        <div class="stack-sm" style="align-items:center">
          <span id="avatarSlot">${avatarEl(p, 'avatar-xl')}</span>
          <label class="btn btn-secondary btn-sm" style="cursor:pointer">Change photo
            <input type="file" id="avatarInput" accept="image/*" hidden></label>
        </div>
        <div style="flex:1;min-width:220px">
          <div class="row" style="gap:.5rem">
            <span class="person-name" style="font-size:1.4rem">${esc(p.full_name)}</span>
            ${p.is_minor ? '<span class="badge badge-info">Under 18</span>' : ''}
            ${p.is_admin ? '<span class="badge badge-brand">Admin</span>' : ''}
          </div>
          ${p.home_area ? `<div class="small muted mt-1">${esc(p.home_area)}</div>` : ''}
          <div class="profile-stats">
            <div class="profile-stat">
              <div class="v">${p.rating_count ? Number(p.rating_avg).toFixed(1) : '—'}</div>
              <div class="k">${p.rating_count ? `from ${p.rating_count} rating${p.rating_count === 1 ? '' : 's'}` : 'no ratings yet'}</div>
            </div>
            <div class="profile-stat">
              <div class="v">${p.rides_completed}</div>
              <div class="k">completed ride${p.rides_completed === 1 ? '' : 's'}</div>
            </div>
            <div class="profile-stat">
              <div class="v">${new Date(p.created_at).getFullYear()}</div>
              <div class="k">member since</div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <section class="card mb-3">
      <div class="card-head"><h3>Public details</h3>
        <span class="tiny muted">Visible to other members</span></div>
      <form id="publicForm">
        <label class="field"><span>Full name</span>
          <input type="text" id="fullName" maxlength="80" value="${esc(p.full_name)}" required></label>
        <label class="field"><span>Area you're based in</span>
          <input type="text" id="homeArea" maxlength="80" value="${esc(p.home_area || '')}" placeholder="Frisco, TX">
          <span class="hint">A city or neighbourhood only. Never enter your street address.</span></label>
        <label class="field"><span>Short bio</span>
          <textarea id="bio" maxlength="400" placeholder="Junior at Frisco High, on the robotics team. Usually driving to practice on Tuesdays and Thursdays.">${esc(p.bio || '')}</textarea></label>
        <label class="field"><span>Age category</span>
          <select id="ageCategory" ${p.age_category === 'adult' ? '' : ''}>
            ${AGE_CATEGORIES.map((a) => `<option value="${a.value}" ${a.value === p.age_category ? 'selected' : ''}>${esc(a.label)}</option>`).join('')}
          </select>
          <span class="hint">${p.age_category === 'adult'
            ? 'You can lower this yourself, but only an administrator can raise it back to adult.'
            : 'Only an administrator can change this to 18 or older.'}</span></label>
        <button class="btn btn-primary" type="submit">Save public details</button>
      </form>
    </section>

    <section class="card mb-3">
      <div class="card-head"><h3>Private details</h3>
        <span class="badge badge-ok">🔒 Never listed publicly</span></div>
      <p class="small muted">Your phone number is released only to people confirmed on a ride with you,
      and to a linked guardian.</p>
      <form id="privateForm">
        <div class="form-grid form-grid-2">
          <label class="field"><span>Email</span>
            <input type="email" id="email" value="${esc(priv?.email || session.user.email || '')}" disabled>
            <span class="hint">Change your sign-in email from the Supabase account settings.</span></label>
          <label class="field"><span>Phone number</span>
            <input type="tel" id="phone" value="${esc(priv?.phone || '')}" placeholder="(555) 123-4567"></label>
        </div>
        <div class="form-grid form-grid-2">
          <label class="field"><span>Emergency contact name</span>
            <input type="text" id="ecName" maxlength="80" value="${esc(priv?.emergency_contact_name || '')}"></label>
          <label class="field"><span>Emergency contact phone</span>
            <input type="tel" id="ecPhone" value="${esc(priv?.emergency_contact_phone || '')}"></label>
        </div>
        <button class="btn btn-primary" type="submit">Save private details</button>
      </form>
    </section>

    <section class="card mb-3">
      <div class="card-head"><h3>Reviews</h3><span class="badge">${ratings.length}</span></div>
      ${ratings.length ? ratings.map(ratingRow).join('') : '<p class="small muted mb-0">No ratings yet — they appear after a completed ride.</p>'}
    </section>

    <section class="card">
      <div class="card-head"><h3>Blocked members</h3><span class="badge">${blocks.length}</span></div>
      ${blocks.length ? blocks.map((b) => `
        <div class="row-between" class="list-row">
          <div class="row" style="gap:.5rem">${avatarEl(b.profile, 'avatar-sm')}
            <span class="small">${esc(b.profile?.full_name || 'Member')}</span></div>
          <button class="btn btn-ghost btn-sm" data-unblock="${esc(b.blocked_id)}">Unblock</button>
        </div>`).join('')
        : '<p class="small muted mb-0">You have not blocked anyone. Blocking hides you from each other entirely.</p>'}
    </section>`;

  $('#signOut').addEventListener('click', async () => { await signOut(); location.href = 'index.html'; });

  $('#avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return toastError('Please choose an image under 3 MB.');
    try { await uploadAvatar(file); toastOk('Photo updated'); renderMine(); }
    catch (err) { toastError(err); }
  });

  $('#publicForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.submitter;
    const area = $('#homeArea').value.trim();
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      // Geocoding the home area lets Find a Ride offer "near my area" without
      // asking for GPS permission. Failure here must not block the save.
      let pos = null;
      if (area && area !== (p.home_area || '')) pos = await geocode(area);

      await updateMyProfile({
        full_name: $('#fullName').value.trim(),
        home_area: area || null,
        bio: $('#bio').value.trim() || null,
        age_category: $('#ageCategory').value,
        onboarded: true,
        ...(pos ? { home_lat: pos.lat, home_lng: pos.lng } : {}),
        ...(area ? {} : { home_lat: null, home_lng: null }),
      });
      toastOk('Profile saved');
      renderMine();
    } catch (err) {
      toastError(err);
      if (btn) { btn.disabled = false; btn.textContent = 'Save public details'; }
    }
  });

  $('#privateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await updateMyPrivateProfile({
        phone: $('#phone').value.trim(),
        emergency_contact_name: $('#ecName').value.trim(),
        emergency_contact_phone: $('#ecPhone').value.trim(),
      });
      toastOk('Private details saved');
    } catch (err) { toastError(err); }
  });

  $$('[data-unblock]').forEach((b) => b.addEventListener('click', async (e) => {
    try { await unblockUser(e.currentTarget.dataset.unblock); toastOk('Unblocked'); renderMine(); }
    catch (err) { toastError(err); }
  }));
}

/* =========================================================== other member */
async function renderOther(id) {
  const [p, ratings] = await Promise.all([
    getProfile(id).catch(() => null), getRatingsFor(id).catch(() => []),
  ]);
  if (!p) { page.innerHTML = emptyState('🚫', 'Profile unavailable', 'This member may have been removed.'); return; }

  page.innerHTML = `
    ${backLink('find-ride.html', 'Back to Find a Ride')}
    <section class="card card-pad-lg mt-2 mb-3">
      <div class="profile-header">
        ${avatarEl(p, 'avatar-xl')}
        <div style="flex:1;min-width:220px">
          <div class="row" style="gap:.5rem">
            <span class="person-name" style="font-size:1.4rem">${esc(p.full_name)}</span>
            ${p.is_suspended ? '<span class="badge badge-danger">Suspended</span>' : ''}
          </div>
          ${p.home_area ? `<div class="small muted mt-1">${esc(p.home_area)}</div>` : ''}
          <div class="profile-stats">
            <div class="profile-stat">
              <div class="v">${p.rating_count ? Number(p.rating_avg).toFixed(1) : '—'}</div>
              <div class="k">${p.rating_count ? `from ${p.rating_count} rating${p.rating_count === 1 ? '' : 's'}` : 'no ratings yet'}</div>
            </div>
            <div class="profile-stat">
              <div class="v">${p.rides_completed}</div>
              <div class="k">completed ride${p.rides_completed === 1 ? '' : 's'}</div>
            </div>
            <div class="profile-stat">
              <div class="v">${new Date(p.created_at).getFullYear()}</div>
              <div class="k">member since</div>
            </div>
          </div>
        </div>
      </div>
      ${p.bio ? `<div class="mt-3"><div class="label">About</div>
        <p class="mb-0" style="white-space:pre-wrap;color:var(--ink-2)">${esc(p.bio)}</p></div>` : ''}
      <div class="row mt-3">
        <button class="btn btn-secondary btn-sm" id="reportBtn">Report</button>
        <button class="btn btn-secondary btn-sm" id="blockBtn">Block</button>
      </div>
      <p class="tiny muted mt-2 mb-0">Contact details are never shown on a profile. They are shared
      only once you're both confirmed on the same ride.</p>
    </section>

    <section class="card">
      <div class="card-head"><h3>Reviews</h3><span class="badge">${ratings.length}</span></div>
      ${ratings.length ? ratings.map(ratingRow).join('') : '<p class="small muted mb-0">No ratings yet.</p>'}
    </section>`;

  $('#blockBtn').addEventListener('click', async () => {
    if (!(await confirmDialog('Block this member?',
      'You will disappear from each other\'s search results and neither of you can join the other\'s rides.', 'Block'))) return;
    try { await blockUser(id); toastOk('Member blocked'); }
    catch (err) { toastError(err); }
  });

  $('#reportBtn').addEventListener('click', () => {
    modal({
      title: `Report ${p.full_name}`,
      body: `<label class="field"><span>Reason</span>
          <select id="rCat">${REPORT_CATEGORIES.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Details</span><textarea id="rDetails" maxlength="2000"></textarea></label>`,
      actions: [
        { label: 'Cancel', onClick: (_, c) => c() },
        { label: 'Submit', cls: 'btn-danger', onClick: async (root, close) => {
            const details = root.querySelector('#rDetails').value.trim();
            if (details.length < 5) return toastError('Please add a few words of detail.');
            await submitReport({ reportedUserId: id, category: root.querySelector('#rCat').value, details });
            close(); toastOk('Report submitted');
          } },
      ],
    });
  });
}

function ratingRow(r) {
  return `<div class="list-row">
    <div class="row-between">
      <div class="row" style="gap:.5rem">${avatarEl(r.rater, 'avatar-sm')}
        <span class="small strong">${esc(r.rater?.full_name || 'Member')}</span></div>
      <div><span class="stars">${starString(r.stars)}</span>
        <span class="tiny muted">${esc(relativeTime(r.created_at))}</span></div>
    </div>
    ${r.comment ? `<p class="small muted mt-1 mb-0">${esc(r.comment)}</p>` : ''}
  </div>`;
}
