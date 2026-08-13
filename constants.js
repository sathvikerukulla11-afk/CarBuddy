/** Shared enum labels. Keep in step with the Postgres enums in /supabase. */

export const AGE_CATEGORIES = [
  { value: 'under_16',  label: 'Under 16',   minor: true },
  { value: 'age_16_17', label: '16 – 17',    minor: true },
  { value: 'adult',     label: '18 or older', minor: false },
];

export const VISIBILITY = [
  {
    value: 'verified',
    label: 'Anyone verified',
    desc: 'Listed publicly. Any verified member can request a seat — you still approve each one.',
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
  upcoming: 'Upcoming', active: 'In progress', completed: 'Completed', cancelled: 'Cancelled',
};

export const REQUEST_STATUS_LABELS = {
  pending: 'Pending', accepted: 'Accepted', rejected: 'Declined', cancelled: 'Cancelled',
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
