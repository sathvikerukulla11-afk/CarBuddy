import {
  mountChrome, requireAuth, $, $$, esc, modal, confirmDialog,
  toastOk, toastError, emptyState, avatarEl, loadingState, errorState,
} from './ui.js';
import {
  myGroups, browseGroups, createGroup, joinGroupByCode,
  groupMembers, setMemberStatus, leaveGroup,
} from './groups.js';
import { GROUP_TYPES } from './constants.js';

await mountChrome();
const session = await requireAuth();
if (!session) throw new Error('redirecting');
const me = session.user.id;
const page = $('#page');

const TYPE_ICON = { school: '🎓', neighborhood: '🏘️', sports: '⚽', club: '🎯', organization: '🏛️', other: '👥' };

async function render() {
  page.innerHTML = loadingState('Loading your trusted groups…', 3);
  let mine, all;
  try {
    [mine, all] = await Promise.all([myGroups(), browseGroups()]);
  } catch (err) {
    page.innerHTML = errorState(err, 'retryGroups');
    $('#retryGroups').addEventListener('click', render);
    return;
  }
  const myIds = new Set(mine.map((m) => m.group.id));

  page.innerHTML = `
    <section class="mb-4">
      <h3 class="mb-2">My groups <span class="badge">${mine.length}</span></h3>
      ${mine.length ? `<div class="grid grid-3">${mine.map(myGroupCard).join('')}</div>`
        : emptyState('👥', 'You are not in a group yet',
            'Ask your school, team, or neighbourhood for their join code — or start a group yourself.')}
    </section>

    <section>
      <h3 class="mb-2">Discover groups</h3>
      <input type="search" id="searchGroups" placeholder="Search by name or area" class="mb-2">
      <div class="grid grid-3" id="browseGrid">
        ${all.filter((g) => !myIds.has(g.id)).map(browseCard).join('')
          || '<p class="muted small">No other groups to show yet.</p>'}
      </div>
    </section>`;

  wire();
}

function myGroupCard(m) {
  const g = m.group;
  const isOwner = g.created_by === me;
  return `
  <article class="card card-hover">
    <div class="row-between" style="align-items:flex-start">
      <div><div class="strong">${TYPE_ICON[g.group_type] || '👥'} ${esc(g.name)}</div>
        <div class="tiny muted">${esc(g.area || '')}${g.area ? ' · ' : ''}${g.member_count} member${g.member_count === 1 ? '' : 's'}</div></div>
      <span class="badge ${m.status === 'active' ? 'badge-ok' : 'badge-warn'}">${m.status === 'active' ? 'Active' : 'Pending approval'}</span>
    </div>
    ${g.description ? `<p class="small muted mt-2 mb-0">${esc(g.description).slice(0, 120)}</p>` : ''}
    ${m.status === 'active' ? `
      <div class="row mt-3" style="gap:.4rem">
        <a class="btn btn-secondary btn-sm" href="find-ride.html">Find group rides</a>
        <button class="btn btn-ghost btn-sm" data-members="${esc(g.id)}">Members</button>
        ${isOwner || m.role === 'admin' ? `<button class="btn btn-ghost btn-sm" data-code="${esc(g.join_code)}" data-name="${esc(g.name)}">Invite code</button>` : ''}
        ${!isOwner ? `<button class="btn btn-ghost btn-sm" data-leave="${esc(g.id)}">Leave</button>` : ''}
      </div>` : '<p class="tiny muted mt-2 mb-0">A group admin needs to approve you before you can see its rides.</p>'}
  </article>`;
}

function browseCard(g) {
  return `
  <article class="card card-hover">
    <div class="strong">${TYPE_ICON[g.group_type] || '👥'} ${esc(g.name)}</div>
    <div class="tiny muted">${esc(g.area || '')}${g.area ? ' · ' : ''}${g.member_count} member${g.member_count === 1 ? '' : 's'}</div>
    ${g.description ? `<p class="small muted mt-2 mb-0">${esc(g.description).slice(0, 120)}</p>` : ''}
    <div class="row mt-3">
      <span class="badge ${g.is_open ? 'badge-ok' : ''}">${g.is_open ? 'Open — join instantly' : 'Approval required'}</span>
      <span class="spacer"></span>
      <button class="btn btn-secondary btn-sm" data-join-code-hint="${esc(g.name)}">Join with code</button>
    </div>
  </article>`;
}

function wire() {
  $('#searchGroups')?.addEventListener('input', async (e) => {
    const results = await browseGroups(e.target.value).catch(() => []);
    const mine = new Set((await myGroups().catch(() => [])).map((m) => m.group.id));
    $('#browseGrid').innerHTML = results.filter((g) => !mine.has(g.id)).map(browseCard).join('')
      || '<p class="muted small">Nothing matches that search.</p>';
    wireBrowse();
  });
  wireBrowse();

  $$('[data-members]').forEach((b) => b.addEventListener('click', () => membersDialog(b.dataset.members)));

  $$('[data-code]').forEach((b) => b.addEventListener('click', () => {
    modal({
      title: `Invite code for ${b.dataset.name}`,
      body: `<p class="muted small">Share this code with people who belong to this community.
        They enter it under "Join with a code".</p>
        <input type="text" readonly value="${esc(b.dataset.code)}"
          style="font-size:1.4rem;text-align:center;letter-spacing:.2em;font-weight:700">`,
      actions: [
        { label: 'Copy', cls: 'btn-primary', onClick: async (root, close) => {
            await navigator.clipboard.writeText(b.dataset.code).catch(() => {});
            toastOk('Code copied'); close();
          } },
        { label: 'Close', onClick: (_, c) => c() },
      ],
    });
  }));

  $$('[data-leave]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Leave this group?', 'You will lose access to rides limited to it.', 'Leave'))) return;
    try { await leaveGroup(b.dataset.leave); toastOk('Left the group'); render(); }
    catch (err) { toastError(err); }
  }));
}

function wireBrowse() {
  $$('[data-join-code-hint]').forEach((b) => b.addEventListener('click', () => joinDialog()));
}

/* ------------------------------------------------------------- dialogs --- */
function joinDialog() {
  modal({
    title: 'Join a trusted group',
    body: `<p class="muted small">Enter the invite code you were given by the group's organiser.</p>
      <label class="field"><span>Invite code</span>
        <input type="text" id="code" placeholder="ABC1234" style="text-transform:uppercase;letter-spacing:.15em"></label>`,
    actions: [
      { label: 'Cancel', onClick: (_, c) => c() },
      { label: 'Join group', cls: 'btn-primary', onClick: async (root, close) => {
          const code = root.querySelector('#code').value.trim();
          if (!code) return toastError('Enter a code first.');
          try {
            const g = await joinGroupByCode(code);
            close();
            toastOk(g.is_open ? `You joined ${g.name}` : `Request sent to ${g.name}`);
            render();
          } catch (err) { toastError(err); }
        } },
    ],
  });
}

function createDialog() {
  modal({
    title: 'Create a trusted group',
    body: `
      <label class="field"><span>Group name *</span>
        <input type="text" id="gName" maxlength="80" placeholder="Frisco High Robotics"></label>
      <label class="field"><span>Type</span>
        <select id="gType">${GROUP_TYPES.map((t) => `<option value="${t.value}">${esc(t.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Area</span>
        <input type="text" id="gArea" maxlength="80" placeholder="Frisco, TX"></label>
      <label class="field"><span>Description</span>
        <textarea id="gDesc" maxlength="300" placeholder="For students and parents on the robotics team."></textarea></label>
      <label class="check"><input type="checkbox" id="gOpen">
        <span>Anyone with the code joins instantly (otherwise you approve each member)</span></label>
      <div class="safety-note">As the group's admin you decide who belongs. Only add people you can
      genuinely vouch for — that trust is the whole point.</div>`,
    actions: [
      { label: 'Cancel', onClick: (_, c) => c() },
      { label: 'Create group', cls: 'btn-primary', onClick: async (root, close) => {
          const name = root.querySelector('#gName').value.trim();
          if (name.length < 2) return toastError('Give the group a name.');
          try {
            const g = await createGroup({
              name, description: root.querySelector('#gDesc').value,
              area: root.querySelector('#gArea').value,
              groupType: root.querySelector('#gType').value,
              isOpen: root.querySelector('#gOpen').checked,
            });
            close();
            toastOk('Group created');
            modal({
              title: 'Share your invite code',
              body: `<p class="muted small">Give this to people in ${esc(g.name)}.</p>
                <input type="text" readonly value="${esc(g.join_code)}"
                  style="font-size:1.4rem;text-align:center;letter-spacing:.2em;font-weight:700">`,
              actions: [{ label: 'Done', cls: 'btn-primary', onClick: (_, c) => { c(); render(); } }],
            });
          } catch (err) { toastError(err); }
        } },
    ],
  });
}

async function membersDialog(groupId) {
  try {
    const members = await groupMembers(groupId);
    const iAmAdmin = members.some((m) => m.user_id === me && m.role === 'admin' && m.status === 'active');
    const { el, close } = modal({
      title: `Members (${members.filter((m) => m.status === 'active').length})`,
      body: members.map((m) => `
        <div class="row-between" style="padding:.5rem 0;border-bottom:1px solid var(--line)">
          <div class="row" style="gap:.5rem">${avatarEl(m.profile, 'avatar-sm')}
            <div><div class="small strong">${esc(m.profile?.full_name || 'Member')}</div>
              <div class="tiny muted">${esc(m.role)}${m.profile?.is_minor ? ' · under 18' : ''}</div></div></div>
          <div class="row" style="gap:.3rem">
            <span class="badge ${m.status === 'active' ? 'badge-ok' : 'badge-warn'}">${esc(m.status)}</span>
            ${iAmAdmin && m.status === 'pending'
              ? `<button class="btn btn-ok btn-sm" data-approve="${esc(m.user_id)}">Approve</button>` : ''}
            ${iAmAdmin && m.status === 'active' && m.user_id !== me
              ? `<button class="btn btn-ghost btn-sm" data-removeM="${esc(m.user_id)}">Remove</button>` : ''}
          </div>
        </div>`).join('') || '<p class="muted mb-0">No members yet.</p>',
      actions: [{ label: 'Close', onClick: (_, c) => c() }],
    });

    el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', async () => {
      try { await setMemberStatus(groupId, b.dataset.approve, 'active'); toastOk('Member approved'); close(); render(); }
      catch (err) { toastError(err); }
    }));
    el.querySelectorAll('[data-removeM]').forEach((b) => b.addEventListener('click', async () => {
      try { await setMemberStatus(groupId, b.dataset.removem, 'removed'); toastOk('Member removed'); close(); render(); }
      catch (err) { toastError(err); }
    }));
  } catch (err) { toastError(err); }
}

$('#joinBtn').addEventListener('click', joinDialog);
$('#createBtn').addEventListener('click', createDialog);
render();
