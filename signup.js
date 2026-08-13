import { mountChrome, $, $$, esc, readableError } from '../ui.js';
import { signUp, signIn, getSession } from '../../../shared/auth.js';

await mountChrome();

const msg = $('#msg');
const show = (html, kind = 'error') => { msg.innerHTML = `<div class="alert alert-${kind}">${html}</div>`; };

if (await getSession()) location.replace('profile.html');

// Highlight the chosen age card and reveal the guardian notice for minors.
function syncAge() {
  const checked = $$('input[name="age"]').find((i) => i.checked);
  $$('.radio-card').forEach((c) => c.classList.toggle('selected', c.contains(checked)));
  $('#minorNote').hidden = checked.value === 'adult';
}
$$('input[name="age"]').forEach((i) => i.addEventListener('change', syncAge));
syncAge();

$('#signupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  msg.innerHTML = '';

  const fullName = $('#fullName').value.trim();
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const ageCategory = $$('input[name="age"]').find((i) => i.checked).value;

  if (fullName.length < 2) return show('Please enter your full name.');
  if (password.length < 8) return show('Use a password of at least 8 characters.');
  if (!$('#agree').checked) return show('Please accept the community rules to continue.');

  btn.disabled = true;
  btn.textContent = 'Creating account…';
  try {
    const result = await signUp({
      email, password, fullName, phone: $('#phone').value.trim(), ageCategory,
    });

    const landing = ageCategory === 'adult' ? 'profile.html' : 'guardian.html';

    // Email confirmation is switched off, so signUp normally returns a live
    // session and the member is straight in.
    if (result.session) {
      location.replace(landing);
      return;
    }

    // No session came back. That happens either because confirmation got turned
    // back on, or because this project returns the user without a session. Try
    // signing in directly before falling back to the "check your email" copy,
    // so the flow works either way without a code change.
    try {
      await signIn({ email, password });
      location.replace(landing);
      return;
    } catch (signInErr) {
      if (!/Email not confirmed/i.test(signInErr.message || '')) throw signInErr;
    }

    $('#signupForm').hidden = true;
    show(
      `<strong>Check your email.</strong> Email confirmation is switched on for this
       project, so we sent a link to <span class="mono">${esc(email)}</span>. Click it, then
       <a href="login.html">log in</a>.` +
      (ageCategory !== 'adult'
        ? ' After that, open the <a href="guardian.html">Parent / Guardian</a> page to get your linking code.'
        : ''),
      'ok'
    );
  } catch (err) {
    show(readableError(err));
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
});
