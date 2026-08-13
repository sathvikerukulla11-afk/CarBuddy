# CarBuddy — safety-focused community carpooling

Plain **HTML + CSS + JavaScript** (ES modules, no framework, no build step) on top of
**Supabase** for auth, database, storage, and realtime. Deploys to **GitHub Pages** as-is.

The backend is deliberately designed so a future **React Native / Expo** app can use it
unchanged — see [Mobile app readiness](#mobile-app-readiness).

---

## 1. Files created

```
index.html              Home / landing page
dashboard.html          Dashboard — welcome, stats, driver request queue, quick actions
find-ride.html          Find a Ride (search + filters)
post-ride.html          Post a Ride
my-rides.html           My Rides (driving / joining / requests to me / my requests)
ride.html               Ride Details (?id=…)
profile.html            Profile — own (editable) or another member's (?id=…)
groups.html             Trusted Groups
safety.html             Safety Center (+ community rules, report form)
login.html              Log in
signup.html             Sign up
reset-password.html     Request a password reset email
update-password.html    Choose a new password (opened from the reset email)
guardian.html           Parent / Guardian dashboard
notifications.html      Notification centre
admin.html              Admin dashboard
404.html                Not found

assets/css/styles.css   Whole design system: tokens, components, responsive rules
assets/js/ui.js         Web-only UI: global navbar/footer, toasts, modals, ride cards,
                        auth guards, loading/error/empty states, back links
assets/js/pages/*.js    One controller per page (15 files)

shared/                 ← copy this folder straight into the Expo app
  config.js             Supabase URL + publishable key            (YOU EDIT THIS)
  client.js             Creates the Supabase client               (swap for RN version)
  constants.js          Enum labels shared by web + mobile
  format.js             Pure helpers: seat states, dates, money, stars
  auth.js               Sign up / in / out, password reset
  profiles.js           Public profile, private profile, avatar upload, verification
  rides.js              Search, create, update, cancel, complete, participants, meetups
  requests.js           Request to join, accept/reject, withdraw, inbox/outbox
  groups.js             Trusted groups + membership
  guardian.js           Guardian linking + ride approval
  safety.js             Reports, blocking, ratings
  notifications.js      List, mark read, realtime subscription
  admin.js              Admin-only reads and actions

supabase/migrations/    8 SQL files — run in order (see §3)
.github/workflows/deploy.yml   GitHub Pages deployment
.nojekyll                Stops GitHub Pages from mangling the folders
```

Nothing was overwritten — this was an empty project directory.

### Finding rides by distance

Rides store `origin_lat` / `origin_lng`, geocoded from the typed place name when
the ride is posted. Find a Ride shows **every current ride** by default; adding a
location turns on a mile-radius slider that filters and sorts by how far each
pickup point is from you.

The distance is computed by `public.search_rides_nearby()` in Postgres, not in the
browser — a bounding box narrows the rows using the coordinate index, then an
exact great-circle check finishes the job. Row Level Security still applies, so a
group-only ride stays invisible to non-members.

Geocoding uses **Nominatim (OpenStreetMap)**: free, no API key, but rate-limited
to one request per second and not intended for heavy commercial use.
`shared/geocode.js` handles the queue and caches results in `localStorage` for a
month. If a place cannot be geocoded the ride still posts — it just will not
appear in radius-filtered results, and the form says so. To switch to Google or
Mapbox later, `shared/geocode.js` is the only file that changes.

### Routing

Plain multi-page navigation — no client-side router, no hash routes, no `href="#"`.
Every link is a real relative URL, so the browser back button, middle-click, and
bookmarking all behave normally.

| Nav item | File |
|---|---|
| Logo / Home | `index.html` |
| Find a Ride | `find-ride.html` |
| Post a Ride | `post-ride.html` |
| Dashboard | `dashboard.html` |
| My Rides | `my-rides.html` |
| Profile | `profile.html` |
| More ▾ | `groups.html`, `safety.html`, `notifications.html`, `guardian.html`, `admin.html` (admins only) |

The navbar is rendered once in `assets/js/ui.js` and injected into the `<div id="nav">`
placeholder on every page, so the two can never drift apart. Signed out it collapses to
Home / Find a Ride / Safety with Log in and Sign up. Signed in it shows the member's name,
photo, unread-notification count, and a working Log out. Below 900px everything folds into
a hamburger drawer.

`ride.html` accepts `?from=find|my-rides|dashboard` so its back link says where you came
from — "← Back to Find a Ride" versus "← Back to My Rides".

**Protected pages** (`dashboard`, `post-ride`, `my-rides`, `profile`, `find-ride`, `ride`,
`groups`, `guardian`, `notifications`) call `requireAuth()`, which redirects to
`login.html?next=…` and returns you to the page you wanted after signing in. `admin.html`
calls `requireAdmin()`. Both are conveniences — Row Level Security is what actually stops
unauthorised reads and writes.

---

## 2. Supabase tables

| Table | Purpose |
|---|---|
| `profiles` | Public-safe profile: name, photo, bio, area, age category, verification, rating, rides completed. **No contact details.** |
| `profiles_private` | Email, phone, date of birth, emergency contact. Readable only by the owner, their guardian, and admins. |
| `rides` | Route, date/time, `seats_offered`, `seats_taken`, generated `seats_remaining`, contribution, notes, visibility, status. |
| `ride_meetups` | Meetup place + notes. Separate table so it can be locked to confirmed riders only. |
| `ride_requests` | One row per ask. `status` (pending/accepted/rejected/cancelled) + `guardian_status`. |
| `ride_participants` | Confirmed seats. The only thing `seats_taken` is ever derived from. |
| `trusted_groups` | School / neighborhood / sports / club / organization, with a join code. |
| `group_members` | Membership + role + pending/active status. |
| `ratings` | 1–5 stars, unique per (ride, rater, ratee). |
| `reports` | Moderation queue with category, details, status, admin notes. |
| `blocked_users` | Two-way invisibility between members. |
| `guardian_relationships` | Guardian ↔ minor link, invite code, active/revoked. |
| `notifications` | Server-written events; read by the bell and (later) mobile push. |

Enums: `age_category`, `verification_status`, `ride_status`, `request_status`,
`guardian_approval`, `ride_visibility`, `participant_status`, `group_type`,
`member_status`, `report_status`, `guardian_link_status`.

Storage: one public `avatars` bucket, writable only inside `avatars/<your-user-id>/`.

---

## 3. SQL to run

Run the files **in order**. Either paste each into the Supabase SQL editor, or use the CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

| File | Contains |
|---|---|
| `0001_types_and_profiles.sql` | Enums, helper functions, `profiles`, `profiles_private`, the signup trigger on `auth.users`, column guards |
| `0002_groups_guardians_blocks.sql` | Trusted groups, group members, blocking, guardian relationships, `can_participate()` |
| `0003_rides_requests_seats.sql` | `rides` (with generated `seats_remaining`), meetups, requests, participants, seat guards |
| `0004_ratings_reports_notifications.sql` | Ratings + rating rollup trigger, reports, notifications, realtime publication |
| `0005_row_level_security.sql` | RLS enabled on all 13 tables, every policy, all grants |
| `0006_rpc_ride_flow.sql` | `request_to_join`, `respond_to_request`, `cancel_request`, `remove_participant`, `cancel_ride`, `complete_ride`, `get_ride_contacts` |
| `0007_rpc_guardian_ratings_groups_admin.sql` | Guardian invite/claim/decide, `rate_user`, group joining, all admin actions |
| `0008_storage_and_bootstrap.sql` | Avatar bucket + storage policies, `bootstrap_admin()`, verification requests |
| `0009_geo_radius_search.sql` | lat/lng on rides and profiles, `miles_between()`, `search_rides_nearby()` |
| `0010_fix_guards_blocking_cascade_deletes.sql` | Guards no longer block `ON DELETE CASCADE` |
| `0011_guards_scoped_to_client_roles.sql` | Guards scoped to client roles so account deletion works |
| `0012_lock_down_function_execute_and_search_path.sql` | Revoke RPC EXECUTE from `anon`; pin every `search_path` |

**All twelve are already applied** to the live project. You only need to run them
if you rebuild the database elsewhere.

Then, **once**, after signing up with the account that should be the administrator:

```sql
select public.bootstrap_admin('you@example.com');
```

It refuses to run a second time, so it cannot be abused later. Further admins are
promoted from the admin dashboard.

### Why overbooking is impossible

`seats_taken` is not writable by any client. A `BEFORE UPDATE` trigger on `rides`
rejects any change to it unless the transaction has been marked privileged, and only
`SECURITY DEFINER` functions can set that mark. Those functions do:

```sql
select * into v_ride from public.rides where id = ... for update;   -- row lock
...check seats_remaining...
update public.rides set seats_taken = seats_taken + v_req.seats_requested ...;
```

Two drivers accepting the last seat at the same instant serialise on that lock; the
second one re-reads a `seats_remaining` of 0 and gets an error. A `CHECK
(seats_taken <= seats_offered)` constraint is the final backstop. The frontend
disabling the button is a courtesy, not the control.

---

## 4. Configuration

**Already done.** `shared/config.js` points at the live project:

| | |
|---|---|
| Supabase project | `ridealong` in **Erukulla's Org** — the project name predates the CarBuddy rename and the ref cannot be changed, so it stays as-is |
| Ref | `dlelgqrpfebevvkdlvba` |
| URL | `https://dlelgqrpfebevvkdlvba.supabase.co` |
| Region | us-east-2 |

All 12 migrations are applied and the database is empty of test data.

There are no other environment variables. The publishable/anon key is *designed* to
ship in client code — every table is behind RLS, so the key alone grants nothing.
**Never put the `service_role` key in this repository.**

### The one thing you must still do by hand

**Authentication → Sign In / Providers → Email → turn OFF "Confirm email".**
There is no API for this setting, so I could not do it for you. Until it is off,
signup sends a verification email and the new account cannot sign in immediately.
The signup page handles both states: with confirmation off it signs you straight
in; with it on it falls back to a "check your email" message.

Also set, in the Supabase dashboard:

- **Authentication → URL Configuration → Site URL**: your GitHub Pages URL
  (e.g. `https://<user>.github.io/<repo>/`)
- **Redirect URLs**: add `https://<user>.github.io/<repo>/*` and, for local work,
  `http://localhost:8000/*`
- **Authentication → Providers → Email**: keep "Confirm email" on for real use.
  Turn it off temporarily if you want to test signup without checking an inbox.

---

## 5. Running it locally

ES modules need a real HTTP server — opening `index.html` from the filesystem will not work.

```bash
cd <project folder>
python3 -m http.server 8000
# or:  npx serve .
```

Then open <http://localhost:8000>. Add `http://localhost:8000/*` to your Supabase
redirect URLs first, or email links will bounce back to the wrong host.

---

## 6. Deploying to GitHub Pages

```bash
git init
git add .
git commit -m "CarBuddy"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Build and deployment → Source: GitHub Actions**. The included
workflow publishes the repository root on every push to `main`. The site appears at
`https://<user>.github.io/<repo>/`.

All internal links are relative, so the sub-path deployment works without changes.
Put your Pages URL into Supabase's Site URL and Redirect URLs, or password reset and
email confirmation will fail.

---

## 7. Testing the finished website

### What I already verified against the live database

Not simulated — these ran as the `authenticated` role with real JWT claims, so
every Row Level Security policy was live:

| Area | Result |
|---|---|
| Signup trigger | profile + private row created, `is_minor` derived correctly |
| Seat maths | 2 → accept → 1 → accept → 0 (Ride Full); rider leaves → back to 1 |
| Last seat, two takers | first accept succeeds, second fails with "Only 0 seat(s) remain"; `seats_taken` never reached 2 |
| Full ride | further requests rejected by the server |
| Radius search | Austin (206 mi) excluded at 15 mi, included at 300 mi, distances correct |
| Guardian gate | under-18 blocked from posting *and* joining with no guardian; driver could not accept until the guardian approved; the teen could not unlink their own guardian |
| 12 tamper attempts | all blocked — seat counts, self-promotion to admin, self-verification, rating inflation, accepting someone else's request, editing/deleting someone else's ride, faking a rating, adding yourself to a ride, pre-accepted requests, calling admin functions, calling `begin_privileged()` |
| Private data | a member sees exactly 1 row in `profiles_private` (their own) and 0 meetup rows for rides they are not on |

Two real bugs surfaced during that run and are fixed in migrations 0010 and 0011:
deleting an account failed because the write guards blocked the foreign-key
cascades. The linter then surfaced a third: every RPC was callable by signed-out
visitors, fixed in 0012.

### Walk it yourself

Start the server, then walk this path. Every step touches the real database.

1. **Sign up** at `signup.html` as *Driver A*. If email confirmation is on, click the link.
2. **Log in** → you land on `dashboard.html`. The navbar shows your name and a Log out button.
3. **Navigate** Home → Find a Ride → Dashboard → Profile using only the navbar. Shrink the
   window below 900px and repeat through the hamburger.
4. **Profile** → set a phone number and photo, save, reload. The values persist.
5. **Post a ride** with 2 seats. You get "Ride posted successfully!" and land on the ride page.
6. **Find a Ride** → the ride appears. Search its destination; it still appears. Search
   nonsense; you get "No rides found. Try changing your search."
7. **Open the ride** → all details load from the database, seats show 🟢 2 seats available.
8. **Sign up as Rider B** in a private window. Request to join → "Request sent. The driver
   will review your request." The ride is *not* joined yet.
9. **Back as Driver A** → Dashboard shows the request. Accept it. Seats drop to 🟡 1 seat
   available, and the count on Find a Ride matches.
10. **As Rider B** → the ride now appears under My Rides → Rides I'm Joining, with the
    meetup point and contact details that were hidden before.
11. **Sign up as Rider C**, request, and have Driver A accept → 🔴 Ride full, and the
    Request to Join button is gone for everyone else.
12. **Rider D** tries to request → the server refuses. Do this by calling
    `request_to_join` from two browsers at the same moment on a one-seat ride: exactly one
    succeeds, the other gets "Only 0 seat(s) left on this ride".
13. **Log out** → you land on the home page.
14. **Visit `dashboard.html` directly while logged out** → you are bounced to
    `login.html?next=dashboard.html`, and after logging in you arrive back at the dashboard.

To prove the security rules rather than trust them, open the browser console while signed
in as Rider B and try:

```js
// all of these must fail
await supabase.from('rides').update({ seats_taken: 0 }).eq('id', '<Driver A ride id>');
await supabase.from('profiles').update({ is_admin: true }).eq('id', '<your id>');
await supabase.from('profiles').update({ verification_status: 'verified' }).eq('id', '<your id>');
await supabase.from('ride_requests').update({ status: 'accepted' }).eq('id', '<your request>');
await supabase.from('profiles_private').select('*');   // returns only your own row
```

---

## 8. Before you launch publicly

Honest list of what is *not* done. Everything above works; these do not:

**Must do**

- [ ] **Run the migrations and fill in `shared/config.js`.** Until then the site loads
      but shows a configuration banner and no data. Nothing is faked or mocked.
- [ ] **Bootstrap an admin** (`select public.bootstrap_admin('…')`) — otherwise no one
      can review reports or approve verifications.
- [ ] **Real identity verification.** Today "verified" means an admin clicked Approve.
      There is no ID document check, licence check, or insurance check. Decide what
      evidence you require and build the intake for it before advertising the badge.
- [ ] **Legal review.** Terms of service, privacy policy, and a clear statement that you
      are not a transport provider. Carrying minors and accepting contributions have
      real regulatory implications that vary by state — get advice.
- [ ] **Minor-safety policy sign-off.** Guardian approval is enforced technically, but you
      still need a written policy on what happens when a report involves a minor, and
      COPPA/parental-consent handling if anyone under 13 could sign up.
- [ ] **Abuse rate limits.** Supabase caps auth requests, but nothing throttles ride
      posting, request spam, or report spam. Add a per-user rate limit (a small
      `rate_limits` table checked inside the RPCs is enough).
- [ ] **Email deliverability.** Supabase's built-in SMTP is for development only and will
      be throttled. Connect your own SMTP provider before real signups.
- [ ] **Run the Supabase advisors** (Database → Advisors) after applying migrations and
      resolve anything flagged.

**Should do**

- [ ] Address autocomplete / geocoding — search is currently plain text matching, so
      "Frisco" and "Frisco, TX" are different strings.
- [ ] Automatic ride completion. Right now a driver marks a ride completed by hand; a
      scheduled job (`pg_cron`) should flip past rides to `completed` so ratings unlock.
- [ ] Email/SMS notifications. Notification rows exist and arrive live in the browser,
      but nothing is emailed or texted yet.
- [ ] Two-way ratings prompt after a ride, and a way to dispute a rating.
- [ ] Group admin transfer, and deleting a group that still has rides attached.
- [ ] Accessibility pass: keyboard traps in modals, focus return, screen-reader labels on
      the star-rating buttons.
- [ ] Automated tests — especially a concurrency test that fires two `respond_to_request`
      calls at the same last seat and asserts one fails.

---

## Mobile app readiness

Everything in `shared/` is plain ES modules with **no DOM access**. To build the Expo app:

1. Copy `shared/` into the app.
2. Replace **only** `shared/client.js`:

   ```js
   import { createClient } from '@supabase/supabase-js';
   import AsyncStorage from '@react-native-async-storage/async-storage';
   import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

   export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
     auth: { storage: AsyncStorage, autoRefreshToken: true,
             persistSession: true, detectSessionInUrl: false },
   });
   ```
3. Everything else — auth, profiles, rides, requests, seat tracking, notifications,
   ratings, trusted groups, guardian relationships, reports — imports unchanged.

No business logic lives in the browser. Seat counting, guardian gating, rating
eligibility, admin authorisation, and visibility rules are all inside Postgres, so the
mobile app inherits identical behaviour and identical security without a rewrite.

`shared/notifications.js` already exposes `subscribe(userId, cb)` over Supabase Realtime;
in Expo you point that callback at `expo-notifications` and you have push.
