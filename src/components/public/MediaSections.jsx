import { ProductMockup } from "./ProductMockups";
import {
  FEATURE_SPOTLIGHTS,
  IN_ACTION_MEDIA,
  INDUSTRY_MEDIA,
  MEDIA_CREDIT,
  TESTIMONIALS,
  TRUSTED_BY_LOGOS,
} from "../../lib/siteMedia";

function MediaFigure({ src, alt, title, text, className = "" }) {
  return (
    <figure className={`nx-media-card ${className}`}>
      <div className="nx-media-card__frame">
        <img src={src} alt={alt} loading="lazy" decoding="async" width={1200} height={800} />
      </div>
      {(title || text) && (
        <figcaption>
          {title ? <h3>{title}</h3> : null}
          {text ? <p>{text}</p> : null}
        </figcaption>
      )}
    </figure>
  );
}

export function IndustryMediaGrid() {
  return (
    <div className="nx-media-grid nx-media-grid--industries">
      {INDUSTRY_MEDIA.map((item) => (
        <MediaFigure key={item.id} src={item.src} alt={item.alt} title={item.title} text={item.text} />
      ))}
    </div>
  );
}

export function InActionGallery() {
  return (
    <div className="nx-media-grid nx-media-grid--action">
      {IN_ACTION_MEDIA.map((item) => (
        <MediaFigure key={item.id} src={item.src} alt={item.alt} title={item.title} />
      ))}
    </div>
  );
}

export function FeatureSpotlights() {
  return (
    <div className="nx-spotlight-grid">
      {FEATURE_SPOTLIGHTS.map((item) => (
        <article key={item.mockup} className="nx-spotlight">
          <div className="nx-spotlight__stage">
            <ProductMockup name={item.mockup} />
          </div>
          <h3>{item.title}</h3>
          <p>{item.blurb}</p>
        </article>
      ))}
    </div>
  );
}

export function TrustedBySection() {
  if (TRUSTED_BY_LOGOS.length === 0) {
    return (
      <div className="nx-empty-media">
        <p>
          Customer logos will appear here once partners grant permission. Nexora does not display placeholder or invented brands.
        </p>
      </div>
    );
  }
  return (
    <div className="nx-trusted-grid">
      {TRUSTED_BY_LOGOS.map((logo) => (
        <img key={logo.name} src={logo.src} alt={logo.alt || logo.name} loading="lazy" />
      ))}
    </div>
  );
}

export function TestimonialsSection() {
  if (TESTIMONIALS.length === 0) {
    return (
      <div className="nx-empty-media">
        <p>
          Real customer reviews will be published here when available. We do not show fictional names, faces, companies, or quotes.
        </p>
      </div>
    );
  }
  return (
    <div className="nx-media-grid nx-media-grid--quotes">
      {TESTIMONIALS.map((t) => (
        <blockquote key={`${t.name}-${t.role}`} className="nx-feature-tile" style={{ margin: 0 }}>
          <p style={{ fontStyle: "italic", color: "#0B1C3D" }}>&ldquo;{t.quote}&rdquo;</p>
          <footer style={{ marginTop: "1rem", fontSize: "0.85rem", color: "#64748B" }}>
            <strong style={{ color: "#0B1C3D" }}>{t.name}</strong> · {t.role}
            {t.company ? ` · ${t.company}` : ""}
          </footer>
        </blockquote>
      ))}
    </div>
  );
}

export function MediaCredit() {
  return <p className="nx-media-credit">{MEDIA_CREDIT}</p>;
}
