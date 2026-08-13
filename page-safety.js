import { mountChrome, currentSession, $, esc, toastOk, toastError, loadingState } from './ui.js';
import { submitReport, myReports } from './safety.js';
import { REPORT_CATEGORIES } from './constants.js';
import { relativeTime } from './format.js';

await mountChrome();

const area = $('#reportArea');
area.innerHTML = loadingState('Loading the report form…', 0);
const session = await currentSession();

if (!session) {
  area.innerHTML = `<div class="alert alert-info mb-0">
    <a href="login.html">Log in</a> to file a report, or
    <a href="signup.html">create an account</a> first.</div>`;
} else {
  const mine = await myReports().catch(() => []);
  area.innerHTML = `
    <form id="reportForm">
      <label class="field"><span>What is this about?</span>
        <select id="cat">${REPORT_CATEGORIES.map((c) => `<option value="${c.value}">${esc(c.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Tell us what happened</span>
        <textarea id="details" maxlength="2000" required
          placeholder="Include names, dates, times, and the route if you can."></textarea></label>
      <button class="btn btn-primary" type="submit">Submit report</button>
      <p class="tiny muted mt-2 mb-0">If anyone is in immediate danger, contact your local emergency
      services first — this form is not monitored around the clock.</p>
    </form>
    ${mine.length ? `
      <hr class="divider">
      <h3>Your previous reports</h3>
      <div class="table-wrap"><table class="data"><thead><tr>
        <th>Filed</th><th>Category</th><th>Status</th></tr></thead><tbody>
        ${mine.map((r) => `<tr><td>${esc(relativeTime(r.created_at))}</td>
          <td>${esc(REPORT_CATEGORIES.find((c) => c.value === r.category)?.label || r.category)}</td>
          <td><span class="badge ${r.status === 'resolved' ? 'badge-ok' : r.status === 'dismissed' ? '' : 'badge-warn'}">${esc(r.status)}</span></td></tr>`).join('')}
      </tbody></table></div>` : ''}`;

  $('#reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const details = $('#details').value.trim();
    if (details.length < 5) return toastError('Please describe what happened.');
    try {
      await submitReport({ category: $('#cat').value, details });
      toastOk('Report submitted — thank you');
      location.reload();
    } catch (err) { toastError(err); }
  });
}
