"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LogIn, Sparkles } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";

export default function LoginPage() {
  const router = useRouter();
  const { hydrated, session, signIn } = useSiteIntent();

  useEffect(() => {
    if (hydrated && session) {
      router.replace("/dashboard");
    }
  }, [hydrated, router, session]);

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow">
          <Sparkles size={14} />
          Local access
        </div>
        <h1 className="page-title">Login</h1>
        <p className="page-copy">
          We&apos;ll keep this simple for now. Use a local session to explore the product shell, add a website,
          and tune the app before wiring in Google auth later.
        </p>
        <div className="hero-actions">
          <button className="button button--primary" type="button" onClick={() => signIn("Local user")}>
            Continue locally
            <LogIn size={16} />
          </button>
          <Link className="button button--secondary" href="/dashboard">
            Skip to dashboard
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <section className="card">
        <h2 className="card__title">Why this exists</h2>
        <p className="card__copy">
          It gives you a no-friction way to move through the app while you shape the onboarding and product
          flows. No Google setup is required yet.
        </p>
        <div className="section-note" style={{ marginTop: 16 }}>
          Once real auth lands, this route can be swapped out without changing the dashboard shell.
        </div>
      </section>
    </div>
  );
}
