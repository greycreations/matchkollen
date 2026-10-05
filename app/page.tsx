"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowRight, KeyRound, Shield, Trophy, Users } from "lucide-react";
import MatchkollenApp from "./matchkollen-app";
import type { AuthUser } from "@/lib/auth";
import { ThemePicker } from "@/components/theme";

type SessionState = { setupRequired: boolean; user: AuthUser | null };
type AuthAction = "login" | "createAdmin" | "logout";

export default function Home() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/auth", { cache: "no-store" });
      const result = await response.json() as SessionState & { error?: string };
      if (!response.ok) throw new Error(result.error || "Inloggningen kunde inte kontrolleras.");
      setSession(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kunde inte ansluta till databasen.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = setTimeout(() => void loadSession(), 0); return () => clearTimeout(timer); }, [loadSession]);

  async function submit(action: AuthAction, values: Record<string, string>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Begäran kunde inte genomföras.");
      if (action === "logout") setSession((current) => current ? { ...current, user: null } : current);
      await loadSession();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Begäran kunde inte genomföras.");
    } finally {
      setBusy(false);
    }
  }

  if (session?.user) return <MatchkollenApp user={session.user} onLogout={() => void submit("logout", {})} />;
  if (loading && !session) return <main className="auth-shell"><div className="auth-card auth-loading"><span className="auth-logo"><Trophy size={20}/></span><p>Startar Matchkollen…</p></div></main>;

  const setupRequired = session?.setupRequired ?? false;
  return <main className="auth-shell">
    <div className="auth-background-mark auth-mark-one"/><div className="auth-background-mark auth-mark-two"/>
    <header className="auth-brand"><span className="auth-logo"><Trophy size={20}/></span><span className="auth-brand-name">Matchkollen<small>SPORT & LAG</small></span><ThemePicker/></header>
    <section className="auth-card">
      <div className="auth-card-top"><span className={setupRequired ? "auth-step setup-step" : "auth-step"}>{setupRequired ? "FÖRSTA STARTEN" : "VÄLKOMMEN TILLBAKA"}</span><div className="auth-step-count">{setupRequired ? "01 / 02" : <KeyRound size={15}/>}</div></div>
      {setupRequired ? <>
        <div className="auth-icon setup-icon"><Shield size={22}/></div>
        <h1>Skapa administratör</h1>
        <p className="auth-copy">Det här är den första konfigurationen. Kontot får full åtkomst och kan sedan skapa användare och styra deras behörigheter.</p>
        <form className="auth-form" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name") ?? "").trim(); const email = String(form.get("email") ?? "").trim(); const password = String(form.get("password") ?? ""); const confirm = String(form.get("confirm") ?? "");
          if (password !== confirm) { setError("Lösenorden matchar inte."); return; }
          void submit("createAdmin", { name, email, password });
        }}>
          <label>Namn<input name="name" autoComplete="name" minLength={2} maxLength={100} required placeholder="Ditt namn" disabled={busy}/></label>
          <label>E-postadress<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="namn@example.com" disabled={busy}/></label>
          <label>Lösenord<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required placeholder="Minst 12 tecken" disabled={busy}/><small>Använd minst 12 tecken.</small></label>
          <label>Bekräfta lösenord<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required placeholder="Skriv lösenordet igen" disabled={busy}/></label>
          {error && <div role="alert" className="auth-error">{error}</div>}
          <button className="auth-submit" disabled={busy}>{busy ? "Skapar konto…" : "Skapa admin-konto"}<ArrowRight size={16}/></button>
        </form>
        <div className="auth-footnote"><Shield size={14}/> Bara det första kontot får bli administratör genom det här flödet.</div>
      </> : <>
        <div className="auth-icon"><Users size={22}/></div>
        <h1>Logga in</h1>
        <p className="auth-copy">Använd ditt konto för att komma åt lagens matcher och statistik.</p>
        <form className="auth-form" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); void submit("login", { email: String(form.get("email") ?? "").trim(), password: String(form.get("password") ?? "") }); }}>
          <label>E-postadress<input name="email" type="email" autoComplete="username" maxLength={254} required placeholder="namn@example.com" disabled={busy}/></label>
          <label>Lösenord<input name="password" type="password" autoComplete="current-password" required placeholder="Ditt lösenord" disabled={busy}/></label>
          {error && <div role="alert" className="auth-error">{error}</div>}
          <button className="auth-submit" disabled={busy}>{busy ? "Loggar in…" : "Logga in"}<ArrowRight size={16}/></button>
        </form>
      </>}
    </section>
    <footer className="auth-footer"><span>Säker inloggning</span><span>Matchkollen · Matcherna sparas automatiskt</span></footer>
  </main>;
}
