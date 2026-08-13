/** Pure formatting helpers — no DOM, no Supabase. Safe to reuse in Expo. */

export function seatState(remaining) {
  const n = Number(remaining ?? 0);
  if (n <= 0) return { level: 'full', label: 'Ride full',  icon: '🔴', cls: 'seats-full' };
  if (n === 1) return { level: 'last', label: '1 seat available', icon: '🟡', cls: 'seats-last' };
  return { level: 'open', label: `${n} seats available`, icon: '🟢', cls: 'seats-open' };
}

export function money(amount) {
  const n = Number(amount || 0);
  if (n <= 0) return 'No contribution';
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

export function contributionLine(amount) {
  const n = Number(amount || 0);
  if (n <= 0) return 'No contribution requested';
  return `${money(n)} contribution — paid directly to the driver`;
}

const DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** 'YYYY-MM-DD' -> local Date at midnight (avoids UTC off-by-one). */
export function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function friendlyDate(dateStr) {
  const d = parseDateOnly(dateStr);
  if (!d) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return DAY[d.getDay()];
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

/** '17:30:00' -> '5:30 PM' */
export function friendlyTime(timeStr) {
  if (!timeStr) return '';
  const [hRaw, min] = String(timeStr).split(':');
  let h = Number(hRaw);
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${suffix}`;
}

export function whenLine(dateStr, timeStr) {
  return [friendlyDate(dateStr), friendlyTime(timeStr)].filter(Boolean).join(' • ');
}

export function relativeTime(iso) {
  if (!iso) return '';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join('').toUpperCase() || '?';
}

export function starString(avg) {
  const n = Math.round(Number(avg || 0));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** Local date + time inputs -> an unambiguous ISO instant for depart_at. */
export function toInstant(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const [hh, mm] = String(timeStr).split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0).toISOString();
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
