import { mountChrome, $, readableError, toastOk } from '../ui.js';
import { updatePassword, getSession } from '../../../shared/auth.js';

await mountChrome();

// Supabase puts the user into a temporary recovery session via the emailed link.
if (!(await getSession())) {
  $('#msg').innerHTML =
    `<div class="alert alert-warn">This page only works from the link in your reset email.
     <a href="reset-password.html">Request a new link</a>.</div>`;
  $('#updateForm').hidden = true;
}

$('#updateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submitBtn');
  const pw = $('#password').value;
  if (pw.length < 8) {
    $('#msg').innerHTML = '<div class="alert alert-error">Use at least 8 characters.</div>';
    return;
  }
  if (pw !== $('#confirm').value) {
    $('#msg').innerHTML = '<div class="alert alert-error">Those passwords do not match.</div>';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    await updatePassword(pw);
    toastOk('Password updated');
    location.replace('dashboard.html');
  } catch (err) {
    $('#msg').innerHTML = `<div class="alert alert-error">${readableError(err)}</div>`;
    btn.disabled = false;
    btn.textContent = 'Update password';
  }
});
