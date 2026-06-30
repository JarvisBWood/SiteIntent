import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

type SectionPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  highlights: string[];
  note: string;
};

export function SectionPage({ eyebrow, title, description, highlights, note }: SectionPageProps) {
  return (
    <div className="page-shell">
      <section className="page-hero">
        <div className="eyebrow">
          <Sparkles size={14} />
          {eyebrow}
        </div>
        <h1 className="page-title">{title}</h1>
        <p className="page-copy">{description}</p>
        <div className="hero-actions">
          <Link className="button button--primary" href="/dashboard">
            Back to dashboard
            <ArrowRight size={16} />
          </Link>
          <Link className="button button--secondary" href="/settings">
            Local setup
          </Link>
        </div>
      </section>

      <div className="page-grid">
        <section className="card">
          <h2 className="card__title">What this phase sets up</h2>
          <p className="card__copy">
            These screens are intentionally lightweight placeholders. They establish the navigation,
            route structure, and content rhythm for the work that comes next.
          </p>
          <ul className="list">
            {highlights.map((item) => (
              <li key={item} className="list__item">
                <span className="list__bullet" aria-hidden="true" />
                <div className="list__content">
                  <p className="list__title">{item}</p>
                  <p className="list__description">Ready for phase-specific data and workflow details.</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <aside className="card">
          <h2 className="card__title">Build note</h2>
          <p className="card__copy">{note}</p>
          <div className="section-note" style={{ marginTop: 16 }}>
            The shell, sidebar state, and styling system are already in place, so later phases can
            focus on content and data without reworking the app chrome.
          </div>
        </aside>
      </div>
    </div>
  );
}
