/** Shared enum labels. Keep in step with the Postgres enums in /supabase. */

export const AGE_CATEGORIES = [
  { value: 'under_16',  label: 'Under 16',   minor: true },
  { value: 'age_16_17', label: '16 – 17',    minor: true },
  { value: 'adult',     label: '18 or older', minor: false },
];

export const VISIBILITY = [
  {
    value: 'verified',
    // The stored enum value is still 'verified'; only the wording changed.
    label: 'Anyone on CarBuddy',
    desc: 'Listed publicly. Any member can request a seat — you still approve each one.',
  },
  {
    value: 'group',
    label: 'People in my trusted groups',
    desc: 'Only members of the group you pick can see or request this ride.',
  },
  {
    value: 'approval',
    label: 'People I approve (unlisted)',
    desc: 'Hidden from search. Share the ride link directly with the people you want.',
  },
];

export const RIDE_STATUS_LABELS = {
  upcoming: 'Upcoming',
  active: 'Under way',      // departure time has passed; the listing has closed
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const REQUEST_STATUS_LABELS = {
  pending: 'Waiting on your driver',
  accepted: 'Confirmed',
  rejected: 'Declined',
  cancelled: 'Closed',
};

export const GUARDIAN_STATUS_LABELS = {
  not_required: 'Not required', pending: 'Awaiting guardian', approved: 'Guardian approved', denied: 'Guardian declined',
};

export const VERIFICATION_LABELS = {
  unverified: 'Unverified', pending: 'Verification pending', verified: 'Verified', rejected: 'Verification rejected',
};

export const GROUP_TYPES = [
  { value: 'school',       label: 'School' },
  { value: 'neighborhood', label: 'Neighborhood' },
  { value: 'sports',       label: 'Sports team' },
  { value: 'club',         label: 'Club' },
  { value: 'organization', label: 'Community organization' },
  { value: 'other',        label: 'Other' },
];

export const REPORT_CATEGORIES = [
  { value: 'unsafe_driving',        label: 'Unsafe driving' },
  { value: 'harassment',            label: 'Harassment or abusive behaviour' },
  { value: 'no_show',               label: 'No-show / stranded me' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'scam_or_payment',       label: 'Payment problem or scam' },
  { value: 'fake_profile',          label: 'Fake or impersonating profile' },
  { value: 'underage_safety',       label: 'Concern about a minor' },
  { value: 'other',                 label: 'Something else' },
];

/**
 * The safety notice shown before someone asks for a seat, and before a driver
 * accepts one. Both confirmations are recorded server-side against this exact
 * version string, so changing the wording must change the version — otherwise
 * old acknowledgements would silently appear to cover new text.
 */
export const SAFETY_NOTICE_VERSION = '2026-08-a';

export const SAFETY_NOTICE = {
  rider: {
    title: 'Before you ask for a seat',
    lead: 'You are arranging a lift with another member of your community, not booking a professional service.',
    points: [
      ['Check who you are travelling with',
       "Read their profile and ratings. Ask which car they'll be in — make, colour and number plate — and check it matches before you get in."],
      ['Tell someone where you are going',
       'Share the ride link with a parent or a friend so somebody who is not travelling knows your route, your time and who is driving.'],
      ['Meet somewhere public',
       'Agree a well-lit public meeting point. Never a private address, and never somewhere you would not wait alone.'],
      ['Trust your instincts',
       "If anything feels wrong — the car, the driver, an extra passenger you weren't told about — don't get in. You never owe anyone an explanation."],
      ['If something goes wrong',
       'Your safety comes first: contact your local emergency services. Afterwards, report the member here so we can act.'],
    ],
  },
  driver: {
    title: 'Before you accept a rider',
    lead: 'You are taking someone into your own car. A few minutes of care now is worth a great deal later.',
    points: [
      ['Check who you are carrying',
       'Read their profile and ratings, and message them first. If they are under 18 their guardian has already approved the ride — you will see that on the request.'],
      ['Agree a public meeting point',
       'Somewhere well lit that you both know. Share the make, colour and plate of your car so they can recognise it.'],
      ['Make sure you are covered',
       'You need a valid licence and insurance for the car you are driving. Accepting a contribution towards fuel is not the same as driving for hire — check your policy if you are unsure.'],
      ['You can always say no',
       'Declining a request needs no reason, and you can remove a rider before the trip. Nobody is entitled to a seat in your car.'],
      ['If something goes wrong',
       'Contact your local emergency services first. Afterwards, report the member here.'],
    ],
  },
  /**
   * Deliberately factual rather than a blanket "we are not liable" claim, which
   * would not hold up anyway — particularly for the under-18s this platform is
   * built for, where waivers are unenforceable in most states.
   */
  standing: [
    'CarBuddy connects people who are already making a journey. We do not employ, train, vet, insure or supervise drivers, and we do not check licences or vehicles.',
    'We are not a party to the arrangement you make with each other, and we do not handle any money. Any contribution is agreed and paid directly between you.',
    'You are responsible for deciding who you travel with, and for your own safety on the journey.',
  ],
};
