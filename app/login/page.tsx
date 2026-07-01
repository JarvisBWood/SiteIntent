"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogIn, ShieldCheck } from "lucide-react";

import { useSiteIntent } from "@/components/site-intent-provider";

export default function LoginPage() {
  const router = useRouter();
  const { hydrated, session, signIn } = useSiteIntent();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (hydrated && session) {
      router.replace("/dashboard");
    }
  }, [hydrated, router, session]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const result = await signIn(email, password);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow">
          <ShieldCheck size={14} />
          Dashboard access
        </div>
        <h1 className="page-title">Sign in</h1>
        <p className="page-copy">
          Use the dashboard admin credentials configured for this environment.
        </p>

        <form className="setup-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field__label">Email</span>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Password</span>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <div className="field__error">{error}</div> : null}

          <div className="setup-actions">
            <button className="button button--primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign in"}
              {submitting ? <LoaderCircle className="spin" size={16} /> : <LogIn size={16} />}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
