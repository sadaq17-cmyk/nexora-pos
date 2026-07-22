/**
 * JS bridge to site.config.ts media catalog for Vite/React pages.
 */
import siteConfig from "../../site.config.ts";

export const MEDIA_CREDIT = siteConfig.media.credit;
export const INDUSTRY_MEDIA = siteConfig.media.industries;
export const IN_ACTION_MEDIA = siteConfig.media.inAction;
export const TRUSTED_BY_LOGOS = siteConfig.media.trustedBy;
export const TESTIMONIALS = siteConfig.media.testimonials;
export const FEATURE_SPOTLIGHTS = siteConfig.media.featureSpotlights;

export { siteConfig };
export default siteConfig;
