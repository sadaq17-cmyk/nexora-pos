/** Social OAuth temporarily disabled until fully configured. */
export const SOCIAL_OAUTH_ENABLED = false;

export const SOCIAL_PROVIDERS = [
  { id: "google", label: "Continue with Google", envKey: "VITE_GOOGLE_OAUTH_URL" },
  { id: "microsoft", label: "Continue with Microsoft", envKey: "VITE_MICROSOFT_OAUTH_URL" },
  { id: "apple", label: "Continue with Apple", envKey: "VITE_APPLE_OAUTH_URL" },
];

export function getSocialProviderConfig() {
  if (!SOCIAL_OAUTH_ENABLED) return [];
  const env = import.meta.env || {};
  return SOCIAL_PROVIDERS
    .map((provider) => ({
      ...provider,
      configured: Boolean(env[provider.envKey]),
      redirectUrl: env[provider.envKey] || "",
    }))
    .filter((provider) => provider.configured);
}
