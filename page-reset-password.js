import { mountChrome, $, readableError } from './ui.js';
import { sendPasswordReset } from './auth.js';

await mountChrome();

$('#resetForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  const email = $('#email').value.trim();
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    await sendPasswordReset(email);
    $('#resetForm').hidden = true;
    $('#msg').innerHTML =
      `<div class="alert alert-ok">If an account exists for <span class="mono">${email}</span>,
       a reset link is on its way. The link opens a page where you choose a new password.</div>`;
  } catch (err) {
    $('#msg').innerHTML = `<div class="alert alert-error">${readableError(err)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Send reset link';
  }
});
