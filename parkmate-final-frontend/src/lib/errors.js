// Turns raw errors (Supabase Auth, the ParkMate API, the network) into short, plain sentences
// that say what happened and what to do next. Never shows stack traces or internal codes.

const GENERIC = 'Something went wrong on our side. Please try again in a moment.';

// Programmer errors and stack-style messages are never shown to people.
function looksTechnical(message) {
  return !message || /\b(undefined|null|NaN)\b|\w+Error\b|cannot read|is not a function|unexpected token|\bat \w+\s*\(/i.test(message);
}

function text(error) {
  return String(error?.message || error?.error_description || '').toLowerCase();
}

export function friendlyAuthError(error) {
  const message = text(error);
  const code = String(error?.code || error?.error_code || '').toLowerCase();
  const status = Number(error?.status || 0);

  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'That email and password don’t match. Check them and try again, or reset your password.';
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Your email isn’t verified yet. Open the verification email we sent you, or request a new one.';
  }
  if (code === 'user_already_exists' || message.includes('already registered') || message.includes('already been registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (code === 'weak_password' || message.includes('password should be') || message.includes('weak password')) {
    return 'Choose a stronger password: at least 8 characters, ideally with a mix of letters and numbers.';
  }
  if (code === 'same_password' || message.includes('different from the old password')) {
    return 'Your new password must be different from your current one.';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (code === 'otp_expired' || message.includes('expired') || message.includes('invalid or has expired')) {
    return 'That link has expired or was already used. Request a new one and try again.';
  }
  if (code === 'validation_failed' || message.includes('unable to validate email') || message.includes('invalid email')) {
    return 'Enter a valid email address.';
  }
  if (code === 'signup_disabled' || message.includes('signups not allowed')) {
    return 'New sign-ups are turned off right now. Please try again later.';
  }
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || message.includes('jwt expired') || message.includes('not authenticated')) {
    return 'Your session has ended. Please sign in again.';
  }
  if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network request failed') || message.includes('load failed')) {
    return 'We couldn’t reach the server. Check your internet connection and try again.';
  }
  if (status >= 500) return GENERIC;
  return error?.message && !looksTechnical(error.message) && !/^(auth|api|fetch)/i.test(error.message) ? error.message : GENERIC;
}

// The API adds a precise `reason` next to the stable `code` and HTTP status. Old handling that
// only looks at code/status keeps working; this table just gives people a better sentence.
export const REASON_MESSAGES = {
  SLOT_TAKEN: 'Someone just booked that slot. Let’s find you another space nearby.',
  OUTSIDE_AVAILABLE_HOURS: 'That time is outside the owner’s opening hours.',
  LISTING_PAUSED: 'The owner has paused this listing for now.',
  LISTING_NOT_APPROVED: 'This listing hasn’t been approved yet, so it can’t be booked.',
  OWN_LISTING: 'You can’t book your own listing.',
};

export function reasonMessage(reason) {
  return REASON_MESSAGES[String(reason || '').toUpperCase()] || '';
}

/** True when the slot was taken by someone else — the cue to open the rescue (alternatives) flow. */
export function isSlotTaken(error) {
  return String(error?.reason || '').toUpperCase() === 'SLOT_TAKEN' || error?.code === 'BOOKING_CONFLICT';
}

const PHOTO_MESSAGES = {
  tooLarge: 'That photo is too large. Photos must be 5 MB or smaller — try a smaller one.',
  wrongType: 'That file type isn’t supported. Please upload a JPEG or PNG photo.',
  limit: 'This space already has the maximum number of photos. Remove one to add another.',
  storageDown: 'Photo storage had a problem. Please try again in a moment.',
  storageOff: 'Photo uploads aren’t available right now. Please try again later.',
};

/** For ParkMate API failures (ApiError has .status, .code, .reason, .context). */
export function friendlyApiError(error) {
  const status = Number(error?.status || 0);
  const known = reasonMessage(error?.reason);
  if (known) return known;

  switch (error?.code) {
    case 'NETWORK_ERROR': return 'We couldn’t reach ParkMate. Check your internet connection and try again.';
    case 'CONFIGURATION_ERROR': return 'ParkMate isn’t fully set up yet. Please contact support.';
    case 'RATE_LIMITED': return 'You’re doing that a bit too fast. Wait a few minutes and try again.';
    case 'BOOKING_CONFLICT': return REASON_MESSAGES.SLOT_TAKEN;
    case 'LISTING_NOT_BOOKABLE': return 'This space can’t be booked for that time. Try a different time or another space.';
    case 'ACCOUNT_HAS_ACTIVE_BOOKINGS': return 'Other drivers have upcoming bookings on your spaces. Pause your listings and try again once those bookings end.';
    case 'NOT_CONFIGURED': return error?.context === 'photo' ? PHOTO_MESSAGES.storageOff : 'This feature isn’t available on the server yet.';
    case 'PHOTO_LIMIT_REACHED': return PHOTO_MESSAGES.limit;
    default: break;
  }
  if (status === 413) return PHOTO_MESSAGES.tooLarge;
  if (status === 415) return PHOTO_MESSAGES.wrongType;
  if (status === 429) return 'You’re doing that a bit too fast. Wait a few minutes and try again.';
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You don’t have permission to do that.';
  if (status === 404) return 'We couldn’t find that. It may have been removed.';
  if (status === 502) return error?.context === 'photo' ? PHOTO_MESSAGES.storageDown : GENERIC;
  if (status === 503) return error?.context === 'photo' ? PHOTO_MESSAGES.storageOff : 'ParkMate is temporarily unavailable. Please try again in a moment.';
  if (status === 422 || status === 400) return (!looksTechnical(error?.message) && error.message) || 'Some of the details aren’t valid. Check them and try again.';
  if (status >= 500) return GENERIC;
  return (!looksTechnical(error?.message) && error.message) || GENERIC;
}

export function friendlyError(error) {
  if (error?.name === 'ApiError') return friendlyApiError(error);
  return friendlyAuthError(error);
}
