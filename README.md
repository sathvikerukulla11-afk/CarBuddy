# CarBuddy — safety-focused community carpooling

Plain **HTML + CSS + JavaScript** (ES modules, no framework, no build step) on top of
**Supabase** for auth, database, storage, and realtime. Deploys to **GitHub Pages** as-is.

The backend is deliberately designed so a future **React Native / Expo** app can use it
unchanged — see [Mobile app readiness](#mobile-app-readiness).

---

## 1. Project layout

```
CarBuddy/                  one flat folder — no subfolders

  ── pages (17) ──────────────────────────────────────────────────────────
  index.html               Home / landing page
  dashboard.html           Welcome, stats, driver request queue, quick actions
  find-ride.html           Every current ride, plus mile-radius filtering
  post-ride.html           Post a Ride
  my-rides.html            Driving / joining / requests to me / my requests
  ride.html                Ride Details (?id=…)
  profile.html             Own profile (editable) or another member's (?id=…)
  groups.html              Trusted Groups
  safety.html              Safety Center, community rules, report form
  login.html               Log in
  signup.html              Sign up
  reset-password.html      Request a password reset email
  update-password.html     Choose a new password (from the reset email)
  guardian.html            Parent / Guardian dashboard
  notifications.html       Notification centre
  admin.html               Admin dashboard
  404.html                 Not found

  ── styling and shared UI ───────────────────────────────────────────────
  styles.css               Whole design system: tokens, components, responsive
  ui.js                    Global navbar/footer, toasts, modals, ride cards,
                           auth guards, loading/error/empty states, back links

  ── one controller per page (15), prefixed `page-` ──────────────────────
  page-dashboard.js  page-find-ride.js  page-post-ride.js  page-my-rides.js
  page-ride.js       page-profile.js    page-groups.js     page-safety.js
  page-guardian.js   page-notifications.js  page-admin.js  page-login.js
  page-signup.js     page-reset-password.js page-update-password.js

  ── data layer (14) — copy these into the Expo app ──────────────────────
  config.js                Supabase URL + publishable key
  client.js                Creates the Supabase client (swap for the RN version)
  constants.js             Enum labels shared by web + mobile
  format.js                Pure helpers: seat states, dates, money, stars
  geocode.js               Nominatim geocoding, rate-limited and cached
  auth.js                  Sign up / in / out, password reset
  profiles.js              Public profile, private profile, avatar, verification
  rides.js                 Search, radius search, create, cancel, participants
  requests.js              Request to join, accept/reject, withdraw, inbox
  groups.js                Trusted groups + membership
  guardian.js              Guardian linking + ride approval
  safety.js                Reports, blocking, ratings
  notifications.js         List, mark read, realtime subscription
  admin.js                 Admin-only reads and actions

  ── database (12) — all already applied to the live project ─────────────
  0001_types_and_profiles.sql  …  0012_lock_down_function_execute_and_search_path.sql

  ── deployment ──────────────────────────────────────────────────────────
  deploy.yml               Optional GitHub Actions workflow (see §6)
  .nojekyll                Stops GitHub Pages mangling the filenames
  .gitignore
  README.md
```

**Naming.** Page controllers carry a `page-` prefix so they cannot collide with the
data-layer modules — `admin.js`, `groups.js`, `guardian.js`, `notifications.js` and
`safety.js` exist in both roles. Everything imports by plain filename: `./ui.js`,
`./rides.js`, and so on.

### Routing

Plain multi-page navigation — no client-side router, no hash routes, no dead anchors.
Every link is a real relative URL, so the back button, middle-click, and bookmarking all
behave normally.

| Nav item | File |
|---|---|
| Logo / Home | `index.html` |
| Find a Ride | `find-ride.html` |
| Post a Ride | `post-ride.html` |
| Dashboard | `dashboard.html` |
| My Rides | `my-rides.html` |
| Profile | `profile.html` |
| More ▾ | `groups.html`, `safety.html`, `notifications.html`, `guardian.html`, `admin.html` (admins only) |

The navbar is rendered once in `ui.js` and injected into the `<div id="nav">`
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

### The admin console

`admin.html` is a single-page console with a sidebar: Dashboard, Users, Rides,
Reports, Verification, Analytics, Settings. On phones the sidebar becomes a
hamburger drawer. It shares the member site's palette, type and components, just
denser — tables instead of cards, and tables collapse into cards below 860px.

**Authorisation is in the database, not the page.** Every read and write calls a
`SECURITY DEFINER` function that begins with `if not public.is_admin() then raise`.
Deleting the JavaScript guard would change nothing: a non-admin calling
`admin_overview()` or `admin_suspend_user()` directly gets *"Administrators only"*
from Postgres. `admin_actions` is protected by RLS so only admins can read it, and
it has no insert policy at all — only the server-side helper can append.

The `role` column is `'admin'` or `'user'`, GENERATED from `is_admin`, so it has a
single source of truth and nobody can write to it — including the account itself.

Every consequential action is recorded in `admin_actions` with the admin, the
target, a human-readable label and a details payload — visible under Settings.

### Messaging

Conversations are tied to a ride and you cannot start one with a stranger. The
only thing that grants membership is a driver accepting a rider — at that moment
`respond_to_request()` calls `add_conversation_member()`, which creates the ride's
conversation on first use and reuses it forever after. `conversations.ride_id` is
`UNIQUE`, so a duplicate is not merely avoided, it is impossible.

One group thread per ride: driver plus every accepted rider. Members are listed in
the chat header, and the ride's route, time and free seats sit above the messages
with a link through to the ride.

**Everything is decided in Postgres.** RLS on all three tables is membership-based,
and there are no INSERT, UPDATE or DELETE policies at all — messages go through
`send_message()`, which stamps `sender_id` from the session, so a sender cannot be
forged and a message cannot be edited or deleted afterwards. Realtime respects the
same policies: a client subscribing to someone else's conversation receives nothing.

Blocking makes a thread read-only for the pair involved and keeps the history.
Cancelled and completed rides keep their conversations, with a banner explaining
the state. Reporting a conversation files into the existing moderation queue; an
admin can read the thread **only** for a reported conversation, and every such view
is written to the admin action log under their name.

### Exchanging phone numbers

Nobody sees anybody's number until a seat is actually confirmed. `get_ride_contacts()`
decides who sees what, in Postgres:

| You are | You see |
|---|---|
| The driver | every confirmed rider's number |
| A confirmed rider | the driver's number (and your own row) |
| A linked guardian | everyone on a ride your minor is confirmed on |
| Pending, rejected or cancelled | nothing — *"Contact details are shared once your seat is confirmed"* |

Co-riders deliberately do **not** get each other's numbers; the exchange is between
you and your driver. Numbers appear inline on the ride page as tappable call and
text links the moment the driver accepts — there is no button to press.

Phone numbers live in `profiles_private`, which no member can read directly. This
function is the only route to them, and it is `SECURITY DEFINER` precisely so the
rule lives in one place.

### What happens when a ride's time arrives

A listing does not linger past its departure. `close_departed_rides()` runs every
five minutes under pg_cron and moves rides through two stages:

| When | Status | What happens |
|---|---|---|
| Departure time passes | `upcoming` → `active` | The listing disappears from Find a Ride, the server refuses new requests, and **the driver is notified** that their listing has closed — including how many riders are travelling with them. Any request still unanswered is closed, and that rider is told their request expired. |
| 12 hours after departure | `active` → `completed` | Ratings unlock and everyone is prompted to leave one. Completed-ride counters increment exactly as they do when a driver taps *Mark completed*. |

The job is idempotent, so a second run inside the same window changes nothing and
counters never double. A driver can still finish a ride early with *Mark completed*;
that path is unchanged. Admins can trigger a run by hand with
`select public.admin_close_departed_rides();`.

### Finding rides by distance

Rides store `origin_lat` / `origin_lng`, geocoded from the typed place name when the ride
is posted. Find a Ride shows **every current ride** by default; adding a location turns on
a mile-radius slider that filters and sorts by how far each pickup point is from you.

The distance is computed by `public.search_rides_nearby()` in Postgres, not in the browser
— a bounding box narrows the rows using the coordinate index, then an exact great-circle
check finishes the job. Row Level Security still applies, so a group-only ride stays
invisible to non-members.

Geocoding uses **Nominatim (OpenStreetMap)**: free, no API key, but rate-limited to one
request per second and not intended for heavy commercial use. `geocode.js` handles
the queue and caches results in `localStorage` for a month. If a place cannot be geocoded
the ride still posts — it just will not appear in radius-filtered results, and the form
says so. To switch to Google or Mapbox later, `geocode.js` is the only file that changes.

---

## 2. Supabase tables

| Table | Purpose |
|---|---|
| `profiles` | Public-safe profile: name, photo, bio, area, age category, verification, rating, rides completed, home coordinates. **No contact details.** |
| `profiles_private` | Email, phone, date of birth, emergency contact. Readable only by the owner, their guardian, and admins. |
| `rides` | Route, coordinates, date/time, `seats_offered`, `seats_taken`, generated `seats_remaining`, contribution, notes, visibility, status. |
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
| `admin_actions` | Append-only audit trail. Readable only by admins, writable only by the server. |
| `conversations` | One per ride (`ride_id` is unique, so duplicates are impossible). |
| `conversation_members` | Who is in a thread, plus `last_read_at`, which drives unread counts. |
| `messages` | Immutable to clients. Written only by `send_message()`. |

Enums: `age_category`, `verification_status`, `ride_status`, `request_status`,
`guardian_approval`, `ride_visibility`, `participant_status`, `group_type`,
`member_status`, `report_status`, `guardian_link_status`.

Storage: one public `avatars` bucket, writable only inside `avatars/<your-user-id>/`.

---

## 3. SQL

**All twenty migrations are already applied to the live project.** You only need to run
them if you rebuild the database elsewhere — in numeric order, pasted into the Supabase SQL
editor. (The Supabase CLI expects them under `supabase/migrations/`; recreate that folder
if you would rather use `supabase db push`.)

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
| `0013_ride_expiry_lifecycle.sql` | `close_departed_rides()` + the pg_cron schedule that runs it |
| `0014_admin_actions_and_role.sql` | `admin_actions` audit table, generated `role` column, logging on every admin write |
| `0015_admin_dashboard_reads.sql` | Overview, activity feed, user detail, ride list and detail |
| `0016_admin_reports_verification_analytics.sql` | Report queue and detail, verification queue, analytics, action log |
| `0017_contacts_and_verification_off.sql` | Contact sharing narrowed to confirmed seats; verification dropped from the activity feed |
| `0018_messaging_schema.sql` | `conversations`, `conversation_members`, `messages`; membership RLS; realtime publication |
| `0019_messaging_rpcs.sql` | send / read / list / report, and the accept hook that creates the conversation |
| `0020_reports_survive_target_deletion.sql` | A report no longer blocks deleting the ride or account it referenced |

Then, **once**, after signing up with the account that should be the administrator:

```sql
select public.bootstrap_admin('you@example.com');
```

It refuses to run a second time, so it cannot be abused later. Further admins are promoted
from the admin dashboard.

### Why overbooking is impossible

`seats_taken` is not writable by any client. A `BEFORE UPDATE` trigger on `rides` rejects
any change to it from a client role, and only `SECURITY DEFINER` functions can mark a
transaction privileged. Those functions do:

```sql
select * into v_ride from public.rides where id = ... for update;   -- row lock
...check seats_remaining...
update public.rides set seats_taken = seats_taken + v_req.seats_requested ...;
```

Two drivers accepting the last seat at the same instant serialise on that lock; the second
re-reads a `seats_remaining` of 0 and gets an error. A `CHECK (seats_taken <=
seats_offered)` constraint is the final backstop. The frontend disabling the button is a
courtesy, not the control.

---

## 4. Configuration

**Already done.** `config.js` points at the live project:

| | |
|---|---|
| Supabase project | `ridealong` in **Erukulla's Org** — the project name predates the CarBuddy rename and the ref cannot be changed, so it stays as-is |
| Ref | `dlelgqrpfebevvkdlvba` |
| URL | `https://dlelgqrpfebevvkdlvba.supabase.co` |
| Region | us-east-2 |

The publishable key is *designed* to ship in client code — every table is behind RLS, so
the key alone grants nothing. **Never put the `service_role` key in this repository.**

### The one thing you must still do by hand

**Authentication → Sign In / Providers → Email → turn OFF "Confirm email".**
There is no API for this setting, so it could not be done for you. Until it is off, signup
sends a verification email and the new account cannot sign in immediately. The signup page
handles both states: with confirmation off it signs you straight in; with it on it falls
back to a "check your email" message.

Also set, in the Supabase dashboard:

- **Authentication → URL Configuration → Site URL**: your GitHub Pages URL
  (e.g. `https://<user>.github.io/<repo>/`)
- **Redirect URLs**: add `https://<user>.github.io/<repo>/*` and, for local work,
  `http://localhost:8000/*`

---

## 5. Running it locally

ES modules need a real HTTP server — opening `index.html` from the filesystem will not work.

```bash
cd CarBuddy
python3 -m http.server 8000
# or:  npx serve .
```

Then open <http://localhost:8000>. Add `http://localhost:8000/*` to your Supabase redirect
URLs first, or email links will bounce back to the wrong host.

---

## 6. Deploying to GitHub Pages

Run these from **inside the `CarBuddy` folder** — it is the repository root.

```bash
cd CarBuddy
git init
git add .
git commit -m "CarBuddy"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch
`main`, folder `/ (root)`. There is no build step, so GitHub serves the files as they are.
The site appears at `https://<user>.github.io/<repo>/`.

> **About `deploy.yml`.** GitHub Actions only reads workflows from `.github/workflows/`,
> and this project has no folders, so the file sits at the top level as a reference and is
> inert. Branch deployment above needs no workflow at all. If you would rather deploy via
> Actions, create the folder and move it: `mkdir -p .github/workflows && git mv deploy.yml
> .github/workflows/`, then switch the Pages source to **GitHub Actions**.

All internal links are relative, so the sub-path deployment works without changes. Put your
Pages URL into Supabase's Site URL and Redirect URLs, or password reset will fail.

---

## 7. Testing

### What was verified against the live database

Not simulated — these ran as the `authenticated` role with real JWT claims, so every Row
Level Security policy was live:

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

Two real bugs surfaced during that run and are fixed in migrations 0010 and 0011: deleting
an account failed because the write guards blocked the foreign-key cascades. The linter then
surfaced a third: every RPC was callable by signed-out visitors, fixed in 0012.

### The admin console

1. Make yourself an admin — see below — then open `admin.html`.
2. **Dashboard** shows seven live counters plus a Safety & reports panel and a
   recent-activity feed. Nothing is hardcoded; every number is a Supabase query.
3. **Users** — search, filter by All / Verified / Unverified / Suspended, then
   *View* for the full record: contact details, ride history, reports involving
   them, and Suspend / Reinstate / Review verification.
4. **Rides** — filter by status, search by driver or place, open one to see the
   route, driver, riders and requests, and cancel it (which really cancels it).
5. **Reports** — the queue, ordered so pending and safety-flagged rise to the top.
   Open one for the reporter, the reported member's history and prior reports, then
   Mark under review / Resolve / Dismiss / Suspend.
6. **Verification** — approve or reject; the badge changes across the site.
7. **Analytics** — 30-day charts. With little data you'll correctly see
   *"Not enough data yet"* rather than invented numbers.
8. **Settings** — your admin account and the full action log.

To prove the security is real, sign in as a normal member and run this in the
console — every line must fail:

```js
await supabase.rpc('admin_overview');                       // Administrators only
await supabase.rpc('admin_suspend_user', { p_user: '<id>', p_suspend: true });
await supabase.from('admin_actions').select('*');           // returns []
await supabase.from('profiles').update({ is_admin: true }).eq('id', '<your id>');
```

### Messaging

1. As a driver, post a ride. As a second account, request a seat.
2. Accept the request. A conversation appears for both of you — check
   **Messages** in the nav; the driver also gets a **Message riders** button on
   the ride page, the rider a **Message driver** button.
3. Send a message from one browser. It appears in the other **without a refresh** —
   that's Supabase Realtime, not polling.
4. Leave one browser on another page: the Messages nav item shows an unread count.
   Open the conversation and it clears.
5. Accept a third account onto the same ride — they join the *same* thread and can
   read the history. No second conversation is created.
6. Sign in as someone unrelated and try `supabase.rpc('conversation_messages', …)`
   with the conversation id — you get "You are not part of this conversation".
7. Use **Report** in the chat header; the report lands in the admin console with a
   *Reported conversation* panel. Opening the messages there is logged under Settings.

### Walk it yourself

1. **Sign up** as *Driver A*. With email confirmation off you land straight on the dashboard.
2. **Navigate** Home → Find a Ride → Dashboard → Profile using only the navbar. Shrink the
   window below 900px and repeat through the hamburger.
3. **Profile** → set a phone number, photo, and home area; save; reload. Values persist, and
   the home area is geocoded so "Near my area" appears on Find a Ride.
4. **Post a ride** with 2 seats. You get "Ride posted successfully!" and land on the ride page.
5. **Find a Ride** → the ride is listed with no search needed. Press *Use my location*, drag
   the radius slider, and watch the list filter by distance. Search nonsense to see
   "No rides found. Try changing your search."
6. **Sign up as Rider B** in a private window. Request to join → "Request sent. The driver
   will review your request." The ride is *not* joined yet.
7. **Back as Driver A** → the Dashboard shows the request. Accept it. Seats drop to 🟡 1 seat
   available everywhere.
8. **As Rider B** → the ride appears under My Rides → Rides I'm Joining, with the meetup point
   and contact details that were hidden before.
9. **Rider C** requests and is accepted → 🔴 Ride full, and the request button is gone.
10. **Log out** → you land on the home page. Visit `dashboard.html` directly → you are bounced
    to `login.html?next=dashboard.html`, and after logging in you arrive at the dashboard.

To prove the security rules rather than trust them, open the console while signed in and try:

```js
// all of these must fail
await supabase.from('rides').update({ seats_taken: 0 }).eq('id', '<someone else's ride>');
await supabase.from('profiles').update({ is_admin: true }).eq('id', '<your id>');
await supabase.from('profiles').update({ verification_status: 'verified' }).eq('id', '<your id>');
await supabase.from('ride_requests').update({ status: 'accepted' }).eq('id', '<a request>');
await supabase.from('profiles_private').select('*');   // returns only your own row
```

---

## 8. Verification is switched off

Verification never gated anything — it was badges and wording only, never a
condition for posting or joining. It is now hidden throughout the member site and
the admin console.

Everything behind it is intact: the `verification_status` column, the
`admin_set_verification()` and `request_verification()` RPCs, and
`VERIFICATION_LABELS`. Turning it back on means restoring `verifiedBadge()` in
`ui.js` (currently a no-op with a comment saying so) and re-adding the admin
section — no migration required.

---

## 9. Before you launch publicly

**Must do**

- [ ] **Turn off "Confirm email"** in the Supabase dashboard (see §4).
- [ ] **Bootstrap an admin** — otherwise nobody can review reports or approve
      verifications. Sign up normally, then run this once in the Supabase SQL editor:
      `select public.bootstrap_admin('you@example.com');`
      It refuses to run a second time. Promote further admins from the console.
- [ ] **Identity verification.** Currently switched off entirely (see above). If you turn
      it back on, decide what evidence you actually require first — an admin clicking
      Approve is not a background check, and the badge shouldn't imply one.
- [ ] **Legal review.** Terms of service, privacy policy, and a clear statement that you are
      not a transport provider. Carrying minors and accepting contributions have real
      regulatory implications that vary by state — get advice.
- [ ] **Minor-safety policy sign-off.** Guardian approval is enforced technically, but you
      still need a written policy for reports involving a minor, and COPPA/parental-consent
      handling if anyone under 13 could sign up.
- [ ] **Abuse rate limits.** Nothing throttles ride posting, request spam, or report spam. A
      small `rate_limits` table checked inside the RPCs is enough.
- [ ] **Email deliverability.** Supabase's built-in SMTP is for development only. Connect your
      own SMTP provider before real signups.
- [ ] **Re-run the Supabase advisors** after any schema change.

**Should do**

- [ ] Address autocomplete in the ride form (the geocoder already supports `suggest()`).
- [ ] Email/SMS notifications — rows exist and arrive live in the browser, but nothing is sent.
- [ ] A way to dispute a rating.
- [ ] Group admin transfer, and deleting a group that still has rides attached.
- [ ] Accessibility pass: focus traps in modals, screen-reader labels on the star buttons.
- [ ] Automated tests, especially a concurrency test firing two `respond_to_request` calls at
      the same last seat.

---

## Mobile app readiness

The 14 data-layer modules listed in §1 are plain ES modules with **no DOM access** — they
never touch `document`, `window`, or the navbar. To build the Expo app:

1. Copy those 14 files into the app (everything except `ui.js` and the `page-*.js` files).
2. Replace **only** `client.js`:

   ```js
   import { createClient } from '@supabase/supabase-js';
   import AsyncStorage from '@react-native-async-storage/async-storage';
   import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

   export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
     auth: { storage: AsyncStorage, autoRefreshToken: true,
             persistSession: true, detectSessionInUrl: false },
   });
   ```
3. Everything else — auth, profiles, rides, radius search, requests, seat tracking,
   notifications, ratings, trusted groups, guardian relationships, reports — imports unchanged.
   In `geocode.js`, swap `currentPosition()` for `expo-location`.

No business logic lives in the browser. Seat counting, guardian gating, rating eligibility,
admin authorisation, distance filtering, and visibility rules are all inside Postgres, so the
mobile app inherits identical behaviour and identical security without a rewrite.

`notifications.js` already exposes `subscribe(userId, cb)` over Supabase Realtime; in
Expo you point that callback at `expo-notifications` and you have push.
