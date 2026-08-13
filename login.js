import { mountChrome, $, toastOk, readableError, qs } from '../ui.js';
import { signIn, getSession } from '../../../shared/auth.js';

await mountChrome();

const msg = $('#msg');
const show = (text, kind = 'error') => {
  msg.innerHTML = `<div class="alert alert-${kind}">${text}</div>`;
};

// Already signed in? Go straight through.
if (await getSession()) location.replace(qs('next') || 'dashboard.html');

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  msg.innerHTML = '';
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await signIn({ email: $('#email').value.trim(), password: $('#password').value });
    toastOk('Welcome back');
    location.replace(qs('next') || 'dashboard.html');
  } catch (err) {
    show(readableError(err));
    btn.disabled = false;
    btn.textContent = 'Log in';
  }
});
