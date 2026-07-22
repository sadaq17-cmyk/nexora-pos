export const SUPPORT_EMAIL = "support@httpsnexorapos.com";
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;

/** Display-safe support address for copy/UI. */
export function supportEmailLabel() {
  return SUPPORT_EMAIL;
}

/** Build a mailto link with optional subject and body. */
export function supportMailto({ subject, body } = {}) {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const query = params.toString();
  return query ? `${SUPPORT_MAILTO}?${query}` : SUPPORT_MAILTO;
}
