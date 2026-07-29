/**
 * Discourage browser / extension password managers from autofilling.
 * Chromium may still ignore these in some cases — there is no guaranteed web API to block it.
 */
export const NO_AUTOFILL_FORM_PROPS = {
  autoComplete: 'off',
} as const;

export const NO_AUTOFILL_LOGIN_ID_PROPS = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

export const NO_AUTOFILL_PASSWORD_PROPS = {
  autoComplete: 'new-password',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;
