import { useState } from "react";
import { getSupabaseClient } from "../lib/supabase";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error } = await getSupabaseClient().auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="card" style={{ maxWidth: 380, margin: "3rem auto" }}>
        <h2>AutoFlow Admin Console</h2>
        <p className="muted">
          Internal-only. Access requires a platform-admin grant on your account
          plus an enrolled MFA factor.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="primary" disabled={busy}>
            Sign in
          </button>
        </form>
        {error && (
          <div className="banner danger" style={{ marginTop: "1rem" }}>
            {error}
          </div>
        )}
      </div>
    </main>
  );
}
