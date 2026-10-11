"use client";
import { ThemePicker } from "./theme";
import { PeriodColorSettings } from "./period-colors";
import { useState } from "react";

type Summary = { users: number; teams: number; profiles: number; matches: number; goals: number; cards: number; logs: number };
type Preview = { summary: Summary; exportedAt: string; fingerprint: string; admins: { name: string; email: string }[] };
export function AdminSettings({ onRestored }: { onRestored: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [password, setPassword] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [backup, setBackup] = useState<unknown>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [restorePassword, setRestorePassword] = useState(""), [confirmation, setConfirmation] = useState("");
  async function request(url: string, values: unknown) {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json() as { error?: string } & Preview;
    if (!response.ok) throw new Error(result.error || "Begäran kunde inte genomföras.");
    return result;
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Åtgärden misslyckades."); } finally { setBusy(false); }
  }
  return <><div className="page-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Inställningar</h1></div></div>{error && <p role="alert" className="settings-feedback">{error}</p>}{message && <p role="status" className="settings-feedback">{message}</p>}
    <PeriodColorSettings themePicker={<ThemePicker/>}/>
    <div className="admin-settings-grid"><section className="panel settings-panel"><h2>Byt administratörens lösenord</h2><p>Denna inloggning behålls. Övriga sessioner för ditt konto avslutas.</p><form className="form-stack" onSubmit={(event) => { event.preventDefault(); void perform(async () => { await request("/api/auth", { action: "changePassword", ...password }); setPassword({ currentPassword: "", newPassword: "", confirmPassword: "" }); setMessage("Lösenordet är ändrat. Övriga sessioner har avslutats."); }); }}><fieldset disabled={busy}>
      <label>Nuvarande lösenord<input type="password" autoComplete="current-password" required maxLength={256} value={password.currentPassword} onChange={(event) => setPassword((old) => ({ ...old, currentPassword: event.target.value }))}/></label>
      <label>Nytt lösenord<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password.newPassword} onChange={(event) => setPassword((old) => ({ ...old, newPassword: event.target.value }))}/></label>
      <label>Bekräfta nytt lösenord<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password.confirmPassword} onChange={(event) => setPassword((old) => ({ ...old, confirmPassword: event.target.value }))}/></label><p className="form-hint">12–256 tecken. Lösenordet sparas inte i aktivitetsloggen.</p><button className="button button-primary">Byt lösenord</button></fieldset></form></section>
    <section className="panel settings-panel"><h2>Backup & återställning</h2><p>Backupen innehåller alla konton, lösenordshashar, behörigheter, profiler, bilder, lag, matcher och loggar. Förvara filen privat. Inloggningssessioner undantas.</p>
      <button className="button button-primary" disabled={busy} onClick={() => void perform(async () => { const response = await fetch("/api/backup", { cache: "no-store" }); if (!response.ok) { const result = await response.json() as { error?: string } & Preview; throw new Error(result.error); } const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `matchkollen-backup-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("Backupen är exporterad."); })}>Exportera backup</button>
      <label className="backup-upload">Välj backupfil (JSON, max 20 MB)<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; setBackup(null); setPreview(null); setConfirmation(""); setRestorePassword(""); if (!file) return; void perform(async () => { if (file.size > 20 * 1024 * 1024) throw new Error("Filen är för stor (max 20 MB)."); let value; try { value = JSON.parse(await file.text()); } catch { throw new Error("Filen innehåller inte giltig JSON."); } const result = await request("/api/backup", { action: "validate", backup: value }); setBackup(value); setPreview(result); }); }}/></label>
      {preview && <div className="backup-preview"><h3>Granska innan återställning</h3><p>Exporterad: {new Date(preview.exportedAt).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" })}</p><dl>{Object.entries(preview.summary).map(([key, count]) => <div key={key}><dt>{{ users: "Konton", teams: "Lag", profiles: "Spelarprofiler", matches: "Matcher", goals: "Mål", cards: "Kort", logs: "Loggposter" }[key]}</dt><dd>{count}</dd></div>)}</dl><p><strong>All befintlig data ersätts. Alla användare loggas ut.</strong> Exportera en aktuell backup först om du vill kunna återgå.</p><p>Logga in efteråt med ett konto från backupen: {preview.admins.map((admin) => `${admin.name} (${admin.email})`).join(", ")} och dess lösenord vid exporttillfället.</p>
        <form className="form-stack" onSubmit={(event) => { event.preventDefault(); if (!window.confirm("Ersätt all data med den granskade backupen? Alla användare loggas ut. Detta kan inte ångras utan en separat backup.")) return; void perform(async () => { await request("/api/backup", { action: "restore", backup, fingerprint: preview.fingerprint, confirm: confirmation, currentPassword: restorePassword }); setBackup(null); setPreview(null); setRestorePassword(""); onRestored(); }); }}><fieldset disabled={busy}><label>Nuvarande administratörslösenord<input type="password" autoComplete="current-password" required maxLength={256} value={restorePassword} onChange={(event) => setRestorePassword(event.target.value)}/></label><label>Skriv ERSÄTT ALL DATA<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required autoComplete="off"/></label><button className="button account-delete-button" disabled={confirmation !== "ERSÄTT ALL DATA"}>Återställ och ersätt all data</button></fieldset></form>
      </div>}<p className="form-hint">Max 20 MB och 10 000 poster. För större installationer: säkerhetskopiera Docker-datavolymen.</p>
    </section></div></>;
}
