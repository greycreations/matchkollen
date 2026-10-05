"use client";
import { useCallback, useEffect, useState } from "react";
import { Avatar, PhotoEditor } from "./profile-photo";

type Profile = { id: number; name: string; photoRevision: number };
type Membership = { id: number; profileId: number; teamId: number; number: number | null; active: number };
type Team = { id: number; name: string; sportName?: string; groupName: string; active: number };
export function PlayerProfiles({ teams, editable, onChanged }: { teams: Team[]; editable: boolean; onChanged: () => Promise<void> }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/profiles", { cache: "no-store" });
    const result = await response.json() as { error?: string; profiles: Profile[]; memberships: Membership[] };
    if (!response.ok) throw new Error(result.error || "Profilerna kunde inte läsas.");
    setProfiles(result.profiles); setMemberships(result.memberships);
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load().catch((cause) => setError(String(cause))); }, 0); return () => clearTimeout(timer); }, [load, teams]);
  async function save(values: Record<string, unknown>) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Kunde inte spara profilen.");
      await load(); await onChanged(); setMessage("Spelarprofilen är uppdaterad.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kunde inte spara."); }
    finally { setBusy(false); }
  }
  return <section className="panel profiles-panel"><h2>Spelarprofiler</h2><p>En profil per spelare, med tröjnummer och aktiv status per lag. Skapa en ny spelare i lagets trupp ovan. Koppla en befintlig profil till fler lag här.</p><p>Du ser endast profiler och lag som ditt konto har tillgång till. Administratören kan koppla spelare mellan alla lag.</p><label>Sök spelare<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Spelarens namn"/></label>{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="profile-list">{profiles.filter((profile) => profile.name.toLocaleLowerCase("sv").includes(search.toLocaleLowerCase("sv"))).map((profile) => <details className="player-profile" key={profile.id}><summary><Avatar kind="player" id={profile.id} name={profile.name} revision={profile.photoRevision}/><span><strong>{profile.name}</strong><small>{memberships.filter((row) => row.profileId === profile.id && row.active === 1).map((row) => { const team = teams.find((team) => team.id === row.teamId); return `${team?.sportName} · ${team?.name}`; }).join(" / ") || "Ingen aktiv lagkoppling"}</small></span></summary><div className="profile-body">
      {editable && <form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ action: "rename", profileId: profile.id, name: String(form.get("name")) }); }}><label>Namn på spelarprofil<input key={profile.name} name="name" defaultValue={profile.name} required maxLength={100}/></label><button className="button button-outline" disabled={busy}>Spara namn</button><p>Namn och bild är gemensamma för alla lag. Tidigare mål behåller sitt sparade spelarnamn.</p></form>}
      {editable && <PhotoEditor kind="player" id={profile.id} name={profile.name} revision={profile.photoRevision} onSaved={async () => { await load(); await onChanged(); }}/>}<h3>Lagkopplingar</h3>
      {teams.filter((team) => team.active === 1).map((team) => { const row = memberships.find((row) => row.profileId === profile.id && row.teamId === team.id); return editable ? <form key={`${team.id}-${row?.number}-${row?.active}`} className="membership-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void save({ action: "membership", profileId: profile.id, teamId: team.id, number: form.get("number") === "" ? null : Number(form.get("number")), active: form.get("active") === "on" }); }}><strong>{team.sportName} · {team.name}{team.groupName ? ` · ${team.groupName}` : ""}</strong><label><input name="active" type="checkbox" defaultChecked={row?.active === 1}/>Aktiv i laget</label><label>Tröjnummer<input type="number" name="number" min="0" max="999" defaultValue={row?.number ?? ""}/></label><button className="button button-outline" disabled={busy}>Spara lagkoppling</button></form> : row ? <p key={team.id}>{team.sportName} · {team.name} · #{row.number ?? "–"} · {row.active ? "Aktiv" : "Inaktiv"}</p> : null; })}
      <p>En inaktiv lagkoppling behåller tidigare matchhistorik och kan aktiveras igen.</p>
    </div></details>)}</div>{!profiles.length && <p>Inga spelarprofiler ännu.</p>}
  </section>;
}
