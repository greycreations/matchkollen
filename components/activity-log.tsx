"use client";
import { useCallback, useEffect, useState } from "react";
type Entry = { id: number; userId: number; userName: string; action: string; category: string; description: string; createdAt: string };
const types: Record<string,string> = { auth: "Inloggning & utloggning", accounts: "Konton & behörigheter", data: "Lag, matcher & händelser", profiles: "Spelarprofiler & kopplingar", photos: "Profilbilder" };
export function ActivityLog() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [users, setUsers] = useState<{ id: number; name: string }[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ userId: "", category: "", from: "", to: "" });
  const [applied, setApplied] = useState(filters);
  const load = useCallback(async (query: typeof filters, before?: number) => {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams(Object.entries(query).filter(([,value]) => value));
      if (before) params.set("before", String(before));
      const response = await fetch(`/api/activity?${params}`, { cache: "no-store" });
      const result = await response.json() as { entries: Entry[]; users: { id: number; name: string }[]; next: number | null; error?: string };
      if (!response.ok) throw new Error(result.error || "Loggen kunde inte läsas.");
      setEntries((old) => before ? [...old, ...result.entries] : result.entries); setUsers(result.users); setNext(result.next); setApplied(query);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Loggen kunde inte läsas."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const timer = setTimeout(() => void load({ userId: "", category: "", from: "", to: "" }), 0); return () => clearTimeout(timer); }, [load]);
  return <><div className="page-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Aktivitetslogg</h1><p className="subheading">Inloggningar och dataändringar. Vanlig visning loggas inte.</p></div></div><section className="panel activity-panel"><form className="activity-filters" onSubmit={(event) => { event.preventDefault(); void load(filters); }}><label>Användare<select value={filters.userId} onChange={(event) => setFilters((old) => ({ ...old, userId: event.target.value }))}><option value="">Alla användare</option>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label>Typ<select value={filters.category} onChange={(event) => setFilters((old) => ({ ...old, category: event.target.value }))}><option value="">Alla typer</option>{Object.entries(types).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Från datum<input type="date" value={filters.from} onChange={(event) => setFilters((old) => ({ ...old, from: event.target.value }))}/></label><label>Till datum<input type="date" min={filters.from} value={filters.to} onChange={(event) => setFilters((old) => ({ ...old, to: event.target.value }))}/></label><button className="button button-primary" disabled={busy}>Visa logg</button></form><p className="form-hint">Tid och datum visas i svensk tid (Europe/Stockholm). Loggen börjar från denna uppdatering och behålls även när konton tas bort.</p>{error && <p role="alert">{error}</p>}{busy && <p role="status">Hämtar logg …</p>}<div className="table-scroll"><table className="data-table activity-table"><caption className="sr-only">Användarnas aktivitet, senaste först</caption><thead><tr><th>Tidpunkt</th><th>Användare</th><th>Typ</th><th>Ändring</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "medium" }).format(new Date(entry.createdAt))}</td><td>{entry.userName}</td><td>{types[entry.category]}</td><td>{entry.description}</td></tr>)}</tbody></table></div>{!busy && !entries.length && <p className="simple-empty">Inga loggposter för detta urval.</p>}{next && <button className="button button-outline" disabled={busy} onClick={() => void load(applied, next)}>Visa äldre poster</button>}</section></>;
}
