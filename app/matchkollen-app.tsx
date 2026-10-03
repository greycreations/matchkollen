"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Award, BarChart3, CalendarDays, Check, ChevronDown, CirclePlus, Clock3, MapPin, Medal, Minus, Pencil, Plus, RotateCcw, Settings2, Shield, Target, Trash2, Trophy, Users, X } from "lucide-react";
import type { AuthUser, Permissions } from "@/lib/auth";

type Sport = { id: number; name: string };
type Team = { id: number; sportId: number; name: string; groupName: string; sportName?: string; active: number };
type Player = { id: number; teamId: number; name: string; number: number | null; active: number };
type Match = { id: number; teamId: number; homeName: string; opponent: string; scheduledAt: string; venue: string; periods: number; status: string; teamName?: string };
type Participant = { id: number; matchId: number; playerId: number; playerName: string; number: number | null; active: number };
type Goal = { id: number; matchId: number; period: number; side: "home" | "away"; playerId: number | null; playerName: string | null; number: number | null; createdAt: string };
type CardType = "red" | "yellow" | "green";
type MatchCard = { id: number; matchId: number; period: number; playerId: number; cardType: CardType; createdAt: string; playerName: string; number: number | null };
type Data = { sports: Sport[]; teams: Team[]; players: Player[]; matches: Match[]; participants: Participant[]; goals: Goal[]; cards: MatchCard[] };
type Tab = "match" | "matcher" | "lag" | "statistik" | "anvandare";
type ManagedUser = { id: number; name: string; email: string; role: "admin" | "user"; permissions: Permissions; active: number; createdAt: string; password?: string };
const permissionLabels = [
  { key: "teams", label: "Sporter & lag" },
  { key: "players", label: "Spelare" },
  { key: "matches", label: "Matcher & laguppställning" },
  { key: "scores", label: "Resultat & matchhändelser" },
] as const;

const blank: Data = { sports: [], teams: [], players: [], matches: [], participants: [], goals: [], cards: [] };
function emptyClientPermissions(): Permissions {
  return { teams: { create: false, edit: false, delete: false }, players: { create: false, edit: false, delete: false }, matches: { create: false, edit: false, delete: false }, scores: { create: false, edit: false, delete: false } };
}

async function api(body?: Record<string, unknown>) {
  const response = await fetch("/api/data", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Kunde inte spara ändringen.");
  return result;
}

function dateLabel(value: string) {
  if (!value) return "Datum saknas";
  const d = new Date(value);
  return new Intl.DateTimeFormat("sv-SE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);
}

export default function MatchkollenApp({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const [data, setData] = useState<Data>(blank);
  const [tab, setTab] = useState<Tab>("match");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [period, setPeriod] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [matchForm, setMatchForm] = useState({ teamId: "", homeName: "", opponent: "", scheduledAt: "", venue: "", periods: "3" });
  const [sportName, setSportName] = useState("");
  const [teamForm, setTeamForm] = useState({ sportId: "", groupName: "", name: "" });
  const [playerForm, setPlayerForm] = useState({ teamId: "", name: "", number: "" });
  const [setupTeamId, setSetupTeamId] = useState("");
  const [statisticsSportId, setStatisticsSportId] = useState("all");
  const [accountUsers, setAccountUsers] = useState<ManagedUser[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });
  const [newPermissions, setNewPermissions] = useState<Permissions>(emptyClientPermissions());

  const refresh = useCallback(async (quiet = false) => {
    try {
      const next = await api() as Data;
      setData(next);
      setSelectedId((old) => old && next.matches.some((m) => m.id === old) ? old : next.matches[0]?.id ?? null);
      setSetupTeamId((old) => old && next.teams.some((t) => String(t.id) === old && t.active === 1) ? old : String(next.teams.find((t) => t.active === 1)?.id ?? ""));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Kunde inte läsa matchdata.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function loadUsers() {
    try {
      const response = await fetch("/api/auth", { cache: "no-store" });
      const result = await response.json() as { users?: ManagedUser[]; error?: string };
      if (!response.ok) throw new Error(result.error || "Användarlistan kunde inte hämtas.");
      setAccountUsers(result.users ?? []);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kunde inte läsa användarkonton."); }
  }

  async function saveAccount(action: string, values: Record<string, unknown>, success: string): Promise<boolean> {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...values }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Ändringen kunde inte sparas.");
      await loadUsers(); setNotice(success); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ändringen kunde inte sparas."); return false; }
    finally { setSaving(false); }
  }

  function updatePermissions(current: Permissions, area: keyof Permissions, action: "create" | "edit" | "delete", checked: boolean): Permissions {
    return { ...current, [area]: { ...current[area], [action]: checked } };
  }

  const selected = data.matches.find((m) => m.id === selectedId) ?? null;
  const team = selected ? data.teams.find((t) => t.id === selected.teamId) : null;
  const currentSportName = team?.sportName ?? data.sports.find((sport) => sport.id === team?.sportId)?.name ?? "";
  const periodUnit = selected?.periods === 2 && currentSportName.toLocaleLowerCase("sv-SE").includes("fotboll") ? "Halvlek" : "Period";
  const periodLabel = (value: number) => `${periodUnit} ${value}`;
  const lineup = selected ? data.participants.filter((p) => p.matchId === selected.id) : [];
  const matchGoals = selected ? data.goals.filter((g) => g.matchId === selected.id) : [];
  const matchCards = selected ? data.cards.filter((card) => card.matchId === selected.id) : [];
  const homeScore = matchGoals.filter((g) => g.side === "home").length;
  const awayScore = matchGoals.filter((g) => g.side === "away").length;
  const teamPlayers = data.players.filter((p) => p.teamId === Number(setupTeamId) && p.active === 1);
  const upcoming = useMemo(() => [...data.matches].sort((a,b) => a.scheduledAt.localeCompare(b.scheduledAt)), [data.matches]);
  const statisticsMatches = data.matches.filter((m) => {
    const sportMatches = statisticsSportId === "all" || data.teams.find((t) => t.id === m.teamId)?.sportId === Number(statisticsSportId);
    return sportMatches && (m.status === "completed" || data.goals.some((g) => g.matchId === m.id));
  });
  const statisticsMatchIds = new Set(statisticsMatches.map((m) => m.id));
  const statisticsGoals = data.goals.filter((g) => statisticsMatchIds.has(g.matchId));
  const statisticsCards = data.cards.filter((card) => statisticsSportId === "all" || data.teams.find((team) => team.id === data.matches.find((match) => match.id === card.matchId)?.teamId)?.sportId === Number(statisticsSportId));
  const statsMatchCount = Math.max(1, statisticsMatches.length);
  const cardTotals = { red: statisticsCards.filter((card) => card.cardType === "red").length, yellow: statisticsCards.filter((card) => card.cardType === "yellow").length, green: statisticsCards.filter((card) => card.cardType === "green").length };
  const scoreForMatch = (matchId: number, side: "home" | "away") => statisticsGoals.filter((g) => g.matchId === matchId && g.side === side).length;
  const wins = statisticsMatches.filter((m) => scoreForMatch(m.id, "home") > scoreForMatch(m.id, "away")).length;
  const draws = statisticsMatches.filter((m) => scoreForMatch(m.id, "home") === scoreForMatch(m.id, "away")).length;
  const losses = statisticsMatches.length - wins - draws;
  const winPercent = wins / statsMatchCount * 100;
  const drawPercent = draws / statsMatchCount * 100;
  const outcomeGradient = statisticsMatches.length
    ? `conic-gradient(#519275 0 ${winPercent}%, #e9a251 ${winPercent}% ${winPercent + drawPercent}%, #c87867 ${winPercent + drawPercent}% 100%)`
    : "#e7f0f2";
  const goalsFor = statisticsGoals.filter((g) => g.side === "home").length;
  const goalsAgainst = statisticsGoals.filter((g) => g.side === "away").length;
  const scorerStats = data.players.map((p) => ({
    ...p,
    teamLabel: data.teams.find((t) => t.id === p.teamId)?.name ?? "Lag",
    goals: statisticsGoals.filter((g) => g.playerId === p.id).length,
    appearances: new Set(data.participants.filter((x) => x.playerId === p.id && statisticsMatchIds.has(x.matchId)).map((x) => x.matchId)).size,
  })).filter((p) => statisticsSportId === "all" || data.teams.find((t) => t.id === p.teamId)?.sportId === Number(statisticsSportId));
  const cardStats = scorerStats.map((player) => ({ ...player, red: statisticsCards.filter((card) => card.playerId === player.id && card.cardType === "red").length, yellow: statisticsCards.filter((card) => card.playerId === player.id && card.cardType === "yellow").length, green: statisticsCards.filter((card) => card.playerId === player.id && card.cardType === "green").length })).map((player) => ({ ...player, totalCards: player.red + player.yellow + player.green })).filter((player) => player.totalCards > 0).sort((a,b) => b.totalCards - a.totalCards || a.name.localeCompare(b.name));
  const topScorers = [...scorerStats].sort((a,b) => b.goals - a.goals || b.appearances - a.appearances || a.name.localeCompare(b.name)).slice(0, 8);
  const mostAppearances = [...scorerStats].sort((a,b) => b.appearances - a.appearances || b.goals - a.goals).slice(0, 8);
  const maxGoals = Math.max(1, ...topScorers.map((p) => p.goals));
  const can = (area: keyof Permissions, action: "create" | "edit" | "delete") => user.role === "admin" || user.permissions[area][action];

  async function run(action: Record<string, unknown>, success?: string) {
    setSaving(true); setError(""); setNotice("");
    try { await api(action); await refresh(true); if (success) setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message : "Ändringen kunde inte sparas."); }
    finally { setSaving(false); }
  }

  async function createMatch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await run({ action: "createMatch", ...matchForm, periods: Number(matchForm.periods) }, "Matchen är sparad.");
    setMatchForm((f) => ({ ...f, opponent: "", scheduledAt: "", venue: "" }));
    setTab("match");
  }

  async function addSport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!sportName.trim()) return;
    await run({ action: "addSport", name: sportName }, "Sporten är tillagd."); setSportName("");
  }

  async function addTeam(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!teamForm.sportId || !teamForm.name.trim()) return;
    await run({ action: "addTeam", ...teamForm }, "Laget är tillagt."); setTeamForm({ sportId: "", groupName: "", name: "" });
  }

  async function addPlayer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!playerForm.teamId || !playerForm.name.trim()) return;
    await run({ action: "addPlayer", ...playerForm, teamId: setupTeamId, number: playerForm.number ? Number(playerForm.number) : null }, "Spelaren är tillagd."); setPlayerForm((f) => ({ ...f, name: "", number: "" }));
  }

  const activeTeamPlayers = selected ? data.players.filter((p) => p.teamId === selected.teamId && p.active === 1 && lineup.some((l) => l.playerId === p.id)) : [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => { e.preventDefault(); setTab("match"); }}><span className="brand-mark"><Trophy size={19} /></span><span>Matchkollen<small>SPORT & LAG</small></span></a>
        <nav className="nav-tabs" aria-label="Huvudmeny">
          <button className={tab === "match" ? "nav-tab active" : "nav-tab"} onClick={() => setTab("match")}>Match</button>
          <button className={tab === "matcher" ? "nav-tab active" : "nav-tab"} onClick={() => setTab("matcher")}>Matcher <span className="nav-count">{data.matches.length}</span></button>
          <button className={tab === "lag" ? "nav-tab active" : "nav-tab"} onClick={() => setTab("lag")}>Lag & spelare</button>
          <button className={tab === "statistik" ? "nav-tab active" : "nav-tab"} onClick={() => setTab("statistik")}>Statistik</button>
          {user.role === "admin" && <button className={tab === "anvandare" ? "nav-tab active" : "nav-tab"} onClick={() => { setTab("anvandare"); void loadUsers(); }}>Användare</button>}
        </nav>
        <div className="top-meta signed-in-meta"><span className="online-dot" />{user.name}<span className="role-pill">{user.role === "admin" ? "Admin" : "Användare"}</span><button className="logout-button" onClick={onLogout}>Logga ut</button></div>
      </header>

      <div className="page-content">
        {notice && <div className="toast success"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Stäng"><X size={15} /></button></div>}
        {error && <div className="toast error"><span>{error}</span><button onClick={() => setError("")} aria-label="Stäng"><X size={15} /></button></div>}
        {loading ? <div className="loading-card">Hämtar matcher och lag …</div> : null}

        {tab === "match" && <>
          <div className="page-heading"><div><p className="eyebrow">MATCHCENTER</p><h1>{selected ? "Pågående match" : "Redo för match?"}</h1><p className="subheading">Registrera mål direkt från planen. Varje mål sparas med period och spelare.</p></div>{can("matches","create") && <button className="button button-primary" onClick={() => setTab("matcher")}><CirclePlus size={17} /> Ny match</button>}</div>
          {selected ? <>
            <section className="match-meta-card">
              <div className="match-label"><span className={selected.status === "completed" ? "live-indicator completed-indicator" : "live-indicator"}>{selected.status === "completed" ? "AVSLUTAD" : selected.status === "live" ? "PÅGÅR" : "MATCH"}</span><span>{team?.sportName ?? data.sports.find((s) => s.id === team?.sportId)?.name ?? "Sport"}{team?.groupName ? ` · ${team.groupName}` : ""}</span></div>
              <div className="match-line"><div className="match-title"><strong>{selected.homeName || team?.name || "Vårt lag"}</strong><span>mot</span><strong>{selected.opponent || "Motståndare"}</strong></div><div className="match-details"><span><CalendarDays size={15}/>{dateLabel(selected.scheduledAt)}</span>{selected.venue && <span><MapPin size={15}/>{selected.venue}</span>}<span><Users size={15}/>{lineup.length} spelare</span></div></div>
              {can("matches","edit") && <button className="icon-button edit-match" title="Ändra lag- och matchuppgifter" onClick={() => { const homeName = window.prompt("Vårt lags namn i den här matchen", selected.homeName); if (homeName === null) return; const opponent = window.prompt("Motståndarlag", selected.opponent); if (opponent !== null) void run({ action: "updateMatch", matchId: selected.id, homeName, opponent }); }}><Settings2 size={16}/></button>}
            </section>
            <section className="scoreboard" aria-label="Matchresultat">
              <div className="score-team home-score"><div className="score-team-name">{selected.homeName || team?.name || "Vårt lag"}</div><div className="score-number" aria-live="polite">{homeScore}</div><div className="score-actions"><button disabled={!can("scores","create")} onClick={() => void run({ action: "goal", matchId: selected.id, period, side: "home" })} aria-label="Öka vårt lags resultat"><Plus size={19}/></button><button disabled={!can("scores","delete")} onClick={() => { const g = [...matchGoals].reverse().find((x) => x.side === "home"); if (g) void run({ action: "deleteGoal", goalId: g.id }); }} aria-label="Minska vårt lags resultat"><Minus size={19}/></button></div></div>
              <div className="score-center"><span className="score-vs">VS</span><span className="score-period">{periodUnit.toLocaleUpperCase("sv-SE")} {period} AV {selected.periods}</span></div>
              <div className="score-team away-score"><div className="score-team-name">{selected.opponent || "Motståndare"}</div><div className="score-number" aria-live="polite">{awayScore}</div><div className="score-actions"><button disabled={!can("scores","create")} onClick={() => void run({ action: "goal", matchId: selected.id, period, side: "away" })} aria-label="Öka motståndarnas resultat"><Plus size={19}/></button><button disabled={!can("scores","delete")} onClick={() => { const g = [...matchGoals].reverse().find((x) => x.side === "away"); if (g) void run({ action: "deleteGoal", goalId: g.id }); }} aria-label="Minska motståndarnas resultat"><Minus size={19}/></button></div></div>
            </section>
            {can("matches","edit") && selected.status !== "completed" && <section className="finish-match-bar"><div><strong>Är matchen färdig?</strong><span>Mål och kort sparas löpande. Avsluta matchen för att markera den som färdig och ta med resultatet i statistiken.</span></div><button className="button button-primary" onClick={() => { if (window.confirm("Avsluta matchen? Resultatet och matchhändelserna sparas i statistiken.")) void run({ action: "finishMatch", matchId: selected.id }, "Matchen är avslutad. Resultatet finns nu i statistiken."); }}><Check size={17}/> Avsluta match & spara resultat</button></section>}
            <section className="period-section"><div className="section-kicker">VÄLJ {periodUnit.toLocaleUpperCase("sv-SE")}</div><div className="period-switcher">{Array.from({ length: selected.periods }, (_, i) => i + 1).map((p) => <button key={p} className={period === p ? "period-chip selected" : "period-chip"} onClick={() => setPeriod(p)}>{periodLabel(p)}</button>)}</div></section>
            <section className="roster-grid">
              <div className="roster-card"><div className="roster-heading"><div><span className="team-accent home-accent"/><div><h2>{selected.homeName || team?.name || "Vårt lag"}</h2><p>Tryck på spelaren för att registrera mål</p></div></div><button className="text-button" onClick={() => setTab("matcher")}>Trupp <ChevronDown size={15}/></button></div>
                {activeTeamPlayers.length ? <div className="player-grid">{[...activeTeamPlayers].sort((a,b) => (a.number ?? 999) - (b.number ?? 999)).map((p) => <div className="player-score-card" key={p.id}><button className="player-button" disabled={saving || !can("scores","create")} onClick={() => void run({ action: "goal", matchId: selected.id, period, side: "home", playerId: p.id })} aria-label={`Registrera mål för ${p.name}`}><span className="player-number">{p.number ?? "·"}</span><span>{p.name}</span></button><div className="player-card-actions" aria-label={`Registrera kort för ${p.name}`}><button className="card-action" title={`Rött kort: ${p.name}`} aria-label={`Rött kort: ${p.name}`} disabled={saving || !can("scores","create")} onClick={() => void run({ action: "card", matchId: selected.id, period, playerId: p.id, cardType: "red" }, `Rött kort registrerat på ${p.name}.`)}><span className="card-swatch red-swatch"/><span className="card-button-label">Rött</span></button><button className="card-action" title={`Gult kort: ${p.name}`} aria-label={`Gult kort: ${p.name}`} disabled={saving || !can("scores","create")} onClick={() => void run({ action: "card", matchId: selected.id, period, playerId: p.id, cardType: "yellow" }, `Gult kort registrerat på ${p.name}.`)}><span className="card-swatch yellow-swatch"/><span className="card-button-label">Gult</span></button><button className="card-action" title={`Grönt kort: ${p.name}`} aria-label={`Grönt kort: ${p.name}`} disabled={saving || !can("scores","create")} onClick={() => void run({ action: "card", matchId: selected.id, period, playerId: p.id, cardType: "green" }, `Grönt kort registrerat på ${p.name}.`)}><span className="card-swatch green-swatch"/><span className="card-button-label">Grönt</span></button></div></div>)}</div> : <div className="empty-roster">Välj spelare till matchen under <button onClick={() => setTab("matcher")}>Matcher</button>.</div>}
              </div>
              <div className="event-card"><div className="event-header"><div><span className="team-accent away-accent"/><div><h2>Matchhändelser</h2><p>Period, målskytt och kort sparas</p></div></div><div className="event-actions">{can("scores","delete") && <button className="text-button" onClick={() => { if (window.confirm("Ta bort alla mål och kort i matchen och nollställa resultatet?")) void run({ action: "resetMatch", matchId: selected.id }, "Resultatet och matchhändelserna är nollställda."); }}><RotateCcw size={14}/> Nollställ</button>}</div></div>
                <div className="event-list">{[...matchGoals].reverse().slice(0, 8).map((g) => <div className="event-row" key={g.id}><span className={g.side === "home" ? "event-period home-event" : "event-period away-event"}>{periodLabel(g.period)}</span><span className="event-name">Mål · {g.playerName ? `${g.playerName}${g.number !== null ? ` · #${g.number}` : ""}` : g.side === "home" ? selected.homeName : selected.opponent}</span><strong>{g.side === "home" ? selected.homeName : selected.opponent}</strong><span className="event-score">{g.side === "home" ? homeScore : awayScore}</span>{can("scores","edit") && <button className="delete-event" title="Ändra period eller lag" onClick={() => { const p = window.prompt(`${periodUnit} (1–${selected.periods})`, String(g.period)); if (p === null) return; const periodValue = Number(p); if (!Number.isInteger(periodValue)) return; const sideValue = window.prompt("Lag: skriv vårt eller motståndare", g.side === "home" ? "vårt" : "motståndare"); if (sideValue === null) return; const side = sideValue.trim().toLowerCase() === "vårt" ? "home" : sideValue.trim().toLowerCase() === "motståndare" ? "away" : null; if (!side) { setError("Skriv ‘vårt’ eller ‘motståndare’."); return; } void run({ action: "updateGoal", goalId: g.id, period: periodValue, side }, "Matchhändelsen är uppdaterad."); }}><Pencil size={12}/></button>}{can("scores","delete") && <button className="delete-event" title="Ångra händelse" onClick={() => void run({ action: "deleteGoal", goalId: g.id })}><X size={13}/></button>}</div>)}{!matchGoals.length && !matchCards.length && <div className="event-empty"><span className="event-empty-icon"><Clock3 size={17}/></span>Inga händelser ännu.<br/>Tryck på spelarens namn för mål eller på Rött, Gult eller Grönt för att registrera ett kort.</div>}</div>
                {matchCards.length ? <div className="card-event-list">{[...matchCards].reverse().map((card) => <div className="card-event-row" key={`card-${card.id}`}><span className="event-period home-event">{periodLabel(card.period)}</span><span className={`card-swatch ${card.cardType}-swatch`}/><span className="event-name">{card.playerName}{card.number !== null ? ` · #${card.number}` : ""}</span><strong>{card.cardType === "red" ? "Rött kort" : card.cardType === "yellow" ? "Gult kort" : "Grönt kort"}</strong>{can("scores","delete") && <button className="delete-event" title="Ta bort kort" aria-label="Ta bort kort" onClick={() => void run({ action: "deleteCard", cardId: card.id })}><X size={13}/></button>}</div>)}</div> : null}
                {matchGoals.length > 8 && <p className="more-events">Visar de 8 senaste av {matchGoals.length} mål.</p>}
              </div>
            </section>
          </> : <section className="empty-state"><div className="empty-icon"><Trophy size={25}/></div><h2>Välj eller skapa en match</h2><p>Förbered en match med datum, plats och trupp. När matchen startar kan du räkna mål och föra matchlogg här.</p><button className="button button-primary" onClick={() => setTab(data.matches.length ? "matcher" : "lag")}><CirclePlus size={17}/>{data.matches.length ? "Visa matcher" : "Lägg till lag först"}</button></section>}
        </>}

        {tab === "matcher" && <>
          <div className="page-heading"><div><p className="eyebrow">SPELPROGRAM</p><h1>Matcher</h1><p className="subheading">Planera kommande matcher och välj vilka som spelar.</p></div></div>
          <div className="management-grid">
            <section className="panel form-panel"><div className="panel-heading"><span className="panel-icon"><CirclePlus size={17}/></span><div><h2>Planera en match</h2><p>Matchen sparas tillsammans med resultatet.</p></div></div>
              <form className="form-stack" onSubmit={createMatch} aria-disabled={!can("matches","create")}>
                <label>Lag<select required value={matchForm.teamId} onChange={(e) => setMatchForm((f) => ({ ...f, teamId: e.target.value, homeName: data.teams.find((t) => String(t.id) === e.target.value)?.name ?? "" }))}><option value="">Välj lag</option>{data.teams.filter((t) => t.active === 1).map((t) => <option key={t.id} value={t.id}>{t.name}{t.groupName ? ` · ${t.groupName}` : ""}</option>)}</select></label>
                <label>Vårt lagnamn i matchen<input value={matchForm.homeName} onChange={(e) => setMatchForm((f) => ({ ...f, homeName: e.target.value }))} placeholder="Exempel: P10 Blå" /></label>
                <label>Motståndare<input required value={matchForm.opponent} onChange={(e) => setMatchForm((f) => ({ ...f, opponent: e.target.value }))} placeholder="Motståndarlag" /></label>
                <div className="form-row"><label>Datum och tid<input required type="datetime-local" value={matchForm.scheduledAt} onChange={(e) => setMatchForm((f) => ({ ...f, scheduledAt: e.target.value }))}/></label><label>Perioder<select value={matchForm.periods} onChange={(e) => setMatchForm((f) => ({ ...f, periods: e.target.value }))}><option value="2">2 perioder</option><option value="3">3 perioder</option></select></label></div>
                <label>Plats<input value={matchForm.venue} onChange={(e) => setMatchForm((f) => ({ ...f, venue: e.target.value }))} placeholder="Hall eller plan" /></label>
                <button className="button button-primary full-button" disabled={saving || !data.teams.length || !can("matches","create")}><CalendarDays size={16}/>{saving ? "Sparar …" : "Spara match"}</button>
                {!data.teams.length && <p className="form-hint">Lägg först till ett lag under Lag & spelare.</p>}
              </form>
            </section>
            <section className="panel schedule-panel"><div className="panel-heading"><span className="panel-icon soft"><CalendarDays size={17}/></span><div><h2>Dina matcher</h2><p>{data.matches.length} sparade matcher</p></div></div>
              {upcoming.length ? <div className="match-list">{upcoming.map((m) => { const t = data.teams.find((x) => x.id === m.teamId); const gs = data.goals.filter((g) => g.matchId === m.id); return <article className={m.id === selectedId ? "match-row selected" : "match-row"} key={m.id}>
                  <button className="match-row-main" onClick={() => { setSelectedId(m.id); setPeriod(1); setTab("match"); }}><span className="match-date-block"><b>{new Date(m.scheduledAt).getDate()}</b><small>{new Intl.DateTimeFormat("sv-SE", { month: "short" }).format(new Date(m.scheduledAt))}</small></span><span className="match-row-details"><b>{m.homeName || t?.name || "Vårt lag"} <span>–</span> {m.opponent}</b><small>{dateLabel(m.scheduledAt)}{m.venue ? ` · ${m.venue}` : ""}</small><small>{t?.sportName ?? data.sports.find((s) => s.id === t?.sportId)?.name ?? "Sport"} · {m.periods} perioder</small></span><span className="match-result">{gs.filter((g) => g.side === "home").length} – {gs.filter((g) => g.side === "away").length}</span></button>
                  <div className="lineup-picker"><span>Spelartrupp{!can("matches","edit") ? " · endast visning" : ""}</span><details><summary>{data.participants.filter((p) => p.matchId === m.id && p.active === 1).length} valda <ChevronDown size={13}/></summary><div className="lineup-popover">{data.players.filter((p) => p.teamId === m.teamId && p.active === 1).length ? data.players.filter((p) => p.teamId === m.teamId && p.active === 1).map((p) => { const checked = data.participants.some((x) => x.matchId === m.id && x.playerId === p.id); return <label key={p.id} className="lineup-option"><input type="checkbox" checked={checked} disabled={!can("matches","edit")} onChange={() => void togglePlayerFor(m.id, p.id, checked, run)}/><span>{p.number !== null ? `#${p.number} ` : ""}{p.name}</span></label>; }) : <p className="mini-empty">Lägg till spelare under Lag & spelare.</p>}</div></details></div>
                  {can("matches","delete") && <button className="remove-match" title="Ta bort match" onClick={() => { if (window.confirm(`Ta bort matchen mot ${m.opponent} och dess matchlogg?`)) void run({ action: "deleteMatch", matchId: m.id }, "Matchen är borttagen."); }}><Trash2 size={15}/></button>}
                </article>; })}</div> : <div className="simple-empty">Inga matcher planerade ännu. Skapa den första med formuläret.</div>}
            </section>
          </div>
        </>}

        {tab === "statistik" && <>
          <div className="page-heading statistics-heading"><div><p className="eyebrow">SÄSONGEN I SIFFROR</p><h1>Statistik</h1><p className="subheading">Små steg, stora mål. Följ matcherna och fira lagets framsteg.</p></div><label className="sport-filter">Visa sport<select value={statisticsSportId} onChange={(e) => setStatisticsSportId(e.target.value)}><option value="all">Alla sporter</option>{data.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
          {statisticsMatches.length || statisticsCards.length ? <>
            <div className="stats-kpis">
              <article className="stat-kpi"><span className="kpi-icon blue-kpi"><CalendarDays size={17}/></span><div><small>Spelade matcher</small><b>{statisticsMatches.length}</b></div><span className="kpi-foot">{wins} vinster · {draws} oavgjorda · {losses} förluster</span></article>
              <article className="stat-kpi"><span className="kpi-icon orange-kpi"><Target size={17}/></span><div><small>Gjorda mål</small><b>{goalsFor}</b></div><span className="kpi-foot">{(goalsFor / statsMatchCount).toFixed(1).replace(".", ",")} mål per match</span></article>
              <article className="stat-kpi"><span className="kpi-icon green-kpi"><Award size={17}/></span><div><small>Vinstandel</small><b>{Math.round((wins / statsMatchCount) * 100)}%</b></div><span className="kpi-foot">{goalsAgainst} insläppta mål totalt</span></article>
              <article className="stat-kpi"><span className="kpi-icon purple-kpi"><Shield size={17}/></span><div><small>Hållna nollor</small><b>{statisticsMatches.filter((m) => scoreForMatch(m.id, "away") === 0).length}</b></div><span className="kpi-foot">Matcher utan insläppt mål</span></article>
            </div>
            <div className="stats-dashboard-grid">
              <section className="panel stats-panel"><div className="stats-panel-title"><div><span className="panel-icon"><BarChart3 size={17}/></span><div><h2>Matchresultat</h2><p>Utfallet för våra lag</p></div></div></div><div className="outcome-chart"><div className="outcome-total" role="img" aria-label={`Matchutfall: ${wins} vinster, ${draws} oavgjorda och ${losses} förluster`} style={{ background: outcomeGradient }}><b>{statisticsMatches.length}</b><span>matcher</span></div><div className="outcome-bars"><div className="outcome-item"><span><i className="outcome-dot win-dot"/>Vinst<b>{wins}</b></span><div className="outcome-track"><i className="win-bar" style={{ width: `${Math.max(wins ? 5 : 0, wins / statsMatchCount * 100)}%` }}/></div></div><div className="outcome-item"><span><i className="outcome-dot draw-dot"/>Oavgjort<b>{draws}</b></span><div className="outcome-track"><i className="draw-bar" style={{ width: `${Math.max(draws ? 5 : 0, draws / statsMatchCount * 100)}%` }}/></div></div><div className="outcome-item"><span><i className="outcome-dot loss-dot"/>Förlust<b>{losses}</b></span><div className="outcome-track"><i className="loss-bar" style={{ width: `${Math.max(losses ? 5 : 0, losses / statsMatchCount * 100)}%` }}/></div></div></div></div><div className="goals-summary"><span>⚽</span><div><b>{goalsFor} – {goalsAgainst}</b><small>Målskillnad totalt</small></div><strong className={goalsFor >= goalsAgainst ? "positive-difference" : "negative-difference"}>{goalsFor - goalsAgainst > 0 ? "+" : ""}{goalsFor - goalsAgainst}</strong></div></section>
              <section className="panel stats-panel"><div className="stats-panel-title"><div><span className="panel-icon soft"><Medal size={17}/></span><div><h2>Skytteligan</h2><p>Flest registrerade mål</p></div></div></div><div className="scorer-chart">{topScorers.filter((p) => p.goals > 0).length ? topScorers.filter((p) => p.goals > 0).slice(0, 6).map((p, i) => <div className="scorer-item" key={p.id}><span className={`scorer-rank rank-${i + 1}`}>{i === 0 ? "★" : i + 1}</span><div className="scorer-info"><span><b>{p.name}</b><small>{p.teamLabel}</small></span><strong>{p.goals}</strong><div className="scorer-track"><i style={{ width: `${Math.max(5, p.goals / maxGoals * 100)}%` }}/></div></div></div>) : <p className="chart-empty">Inga spelarmål ännu. Tryck på en spelares namn under matchen så dyker skytteligans första mål upp här.</p>}</div></section>
              <section className="panel stats-panel team-stats-panel"><div className="stats-panel-title"><div><span className="panel-icon green-icon"><Trophy size={17}/></span><div><h2>Lagöversikt</h2><p>Matcher, mål och vinstsvit</p></div></div></div><div className="team-stat-table"><div className="team-stat-head"><span>Lag</span><span>Matcher</span><span>Mål</span><span>V–O–F</span></div>{data.teams.filter((t) => statisticsSportId === "all" || t.sportId === Number(statisticsSportId)).map((t) => { const tm = statisticsMatches.filter((m) => m.teamId === t.id); const gf = tm.reduce((sum,m) => sum + scoreForMatch(m.id,"home"),0); const ga = tm.reduce((sum,m) => sum + scoreForMatch(m.id,"away"),0); const tw = tm.filter((m) => scoreForMatch(m.id,"home") > scoreForMatch(m.id,"away")).length; const td = tm.filter((m) => scoreForMatch(m.id,"home") === scoreForMatch(m.id,"away")).length; const tl = tm.length-tw-td; return <div className="team-stat-row" key={t.id}><span className="team-stat-name"><i>{t.name.slice(0,1).toUpperCase()}</i><span><b>{t.name}{t.groupName ? ` · ${t.groupName}` : ""}</b><small>{t.sportName ?? data.sports.find((s)=>s.id===t.sportId)?.name}</small></span></span><b>{tm.length}</b><b>{gf}–{ga}</b><span className="record-chip">{tw}–{td}–{tl}</span></div>; })}</div></section>
              <section className="panel stats-panel attendance-panel"><div className="stats-panel-title"><div><span className="panel-icon purple-icon"><Users size={17}/></span><div><h2>Närvaro & delaktighet</h2><p>Matcher spelade och mål per spelare</p></div></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Spelare</th><th>Matcher</th><th>Mål</th><th>Mål / match</th></tr></thead><tbody>{[...scorerStats].sort((a,b) => b.appearances - a.appearances || b.goals-a.goals).map((p) => <tr key={p.id}><td><b>{p.name}</b><small>{p.teamLabel}</small></td><td>{p.appearances}</td><td>{p.goals}</td><td>{p.appearances ? (p.goals/p.appearances).toFixed(2).replace(".", ",") : "–"}</td></tr>)}</tbody></table></div>{mostAppearances[0]?.appearances ? <div className="record-callout"><Medal size={17}/><span><b>{mostAppearances[0].name}</b> leder närvaroligan med {mostAppearances[0].appearances} matcher!</span></div> : <p className="chart-empty">Välj spelare till matchtruppen så räknas deras matcher här.</p>}</section>
              <section className="panel stats-panel card-stats-panel"><div className="stats-panel-title"><div><span className="panel-icon card-stats-icon"><Shield size={17}/></span><div><h2>Kort per spelare</h2><p>Fair play och matchdisciplin · {statisticsSportId === "all" ? "alla sporter" : data.sports.find((sport) => sport.id === Number(statisticsSportId))?.name}</p></div></div></div><div className="card-total-strip"><div><span className="card-swatch red-swatch"/><b>{cardTotals.red}</b><small>Röda</small></div><div><span className="card-swatch yellow-swatch"/><b>{cardTotals.yellow}</b><small>Gula</small></div><div><span className="card-swatch green-swatch"/><b>{cardTotals.green}</b><small>Gröna</small></div></div>{cardStats.length ? <div className="table-scroll"><table className="data-table card-stats-table"><thead><tr><th>Spelare</th><th>Röda</th><th>Gula</th><th>Gröna</th><th>Totalt</th></tr></thead><tbody>{cardStats.map((player) => <tr key={player.id}><td><b>{player.name}</b><small>{player.teamLabel}</small></td><td>{player.red}</td><td>{player.yellow}</td><td>{player.green}</td><td><strong>{player.totalCards}</strong></td></tr>)}</tbody></table></div> : <p className="chart-empty">Inga kort registrerade för den här sporten ännu. Under en match kan du trycka på kortsymbolen vid spelarens namn.</p>}</section>
            </div>
            <section className="panel results-panel"><div className="stats-panel-title"><div><span className="panel-icon"><CalendarDays size={17}/></span><div><h2>Senaste matcherna</h2><p>Resultat från avslutade och pågående matcher</p></div></div></div><div className="table-scroll"><table className="data-table results-table"><thead><tr><th>Datum</th><th>Lag</th><th>Motståndare</th><th>Resultat</th><th>Utfall</th></tr></thead><tbody>{[...statisticsMatches].sort((a,b) => b.scheduledAt.localeCompare(a.scheduledAt)).map((m) => { const t = data.teams.find((x) => x.id === m.teamId); const gf = scoreForMatch(m.id,"home"), ga=scoreForMatch(m.id,"away"); const result = gf > ga ? "Vinst" : gf === ga ? "Oavgjort" : "Förlust"; return <tr key={m.id}><td>{new Intl.DateTimeFormat("sv-SE",{day:"numeric",month:"short",year:"numeric"}).format(new Date(m.scheduledAt))}</td><td>{m.homeName || t?.name}</td><td>{m.opponent}</td><td className="table-score">{gf} – {ga}</td><td><span className={`result-pill ${result === "Vinst" ? "result-win" : result === "Förlust" ? "result-loss" : "result-draw"}`}>{result}</span></td></tr>; })}</tbody></table></div></section>
          </> : <section className="stats-empty"><div className="empty-icon"><BarChart3 size={25}/></div><h2>Första matchen blir startskottet</h2><p>När ni har registrerat mål under en match eller avslutat en match dyker skytteliga, lagresultat och närvaro upp här.</p><button className="button button-primary" onClick={() => setTab("matcher")}><CalendarDays size={16}/>Planera en match</button></section>}
        </>}

        {tab === "anvandare" && user.role === "admin" && <>
          <div className="page-heading"><div><p className="eyebrow">ADMINISTRATION</p><h1>Användare & behörigheter</h1><p className="subheading">Skapa konton och välj vad varje användare får lägga till, ändra och ta bort.</p></div></div>
          <div className="user-admin-grid">
            <section className="panel user-create-panel"><div className="panel-heading"><span className="panel-icon"><Users size={17}/></span><div><h2>Skapa användarkonto</h2><p>Användaren loggar in med sin e-post och lösenord.</p></div></div>
              <form className="form-stack" onSubmit={(event) => { event.preventDefault(); void saveAccount("createUser", { ...newUser, permissions: newPermissions }, "Användarkontot är skapat.").then((ok) => { if (ok) { setNewUser({ name: "", email: "", password: "" }); setNewPermissions(emptyClientPermissions()); } }); }}>
                <label>Namn<input required minLength={2} maxLength={100} value={newUser.name} onChange={(e) => setNewUser((f) => ({ ...f, name: e.target.value }))} placeholder="Användarens namn" autoComplete="name"/></label>
                <label>E-postadress<input required type="email" maxLength={254} value={newUser.email} onChange={(e) => setNewUser((f) => ({ ...f, email: e.target.value }))} placeholder="namn@example.com" autoComplete="email"/></label>
                <label>Temporärt lösenord<input required type="password" minLength={12} maxLength={256} value={newUser.password} onChange={(e) => setNewUser((f) => ({ ...f, password: e.target.value }))} placeholder="Minst 12 tecken" autoComplete="new-password"/><small>Ge lösenordet direkt till användaren på ett säkert sätt.</small></label>
                <div className="permission-heading"><b>Behörigheter</b><small>Välj vilka åtgärder kontot får göra.</small></div>
                <PermissionMatrix value={newPermissions} disabled={saving} onChange={(area, action, checked) => setNewPermissions((old) => updatePermissions(old, area, action, checked))}/>
                <button className="button button-primary full-button" disabled={saving}>{saving ? "Skapar konto…" : <><Plus size={15}/>Skapa användare</>}</button>
              </form>
            </section>
            <section className="panel user-list-panel"><div className="panel-heading"><span className="panel-icon soft"><Shield size={17}/></span><div><h2>Registrerade konton</h2><p>{accountUsers.length} konton</p></div></div>
              {accountUsers.length ? <div className="account-list">{accountUsers.map((account) => <article className={account.active ? "account-card" : "account-card account-disabled"} key={account.id}>
                <div className="account-summary"><span className="account-avatar">{account.name.slice(0,1).toUpperCase()}</span><span className="account-identity"><b>{account.name}</b><small>{account.email}</small></span><span className={account.active ? "account-state active-state" : "account-state inactive-state"}>{account.active ? "Aktiv" : "Avstängd"}</span><span className="account-role">{account.role === "admin" ? "Admin" : "Användare"}</span></div>
                {account.role === "user" && <>
                  <details className="account-details"><summary><Pencil size={13}/> Redigera konto & behörighet</summary><form className="account-edit-form" onSubmit={(event) => { event.preventDefault(); void saveAccount("updateUser", { userId: account.id, name: account.name, email: account.email, password: account.password ?? "", permissions: account.permissions }, "Användarkontot är uppdaterat."); }}>
                    <label>Namn<input value={account.name} onChange={(e) => setAccountUsers((all) => all.map((a) => a.id === account.id ? { ...a, name: e.target.value } : a))}/></label>
                    <label>E-post<input type="email" value={account.email} onChange={(e) => setAccountUsers((all) => all.map((a) => a.id === account.id ? { ...a, email: e.target.value } : a))}/></label>
                    <label>Nytt lösenord <small>(lämna tomt för att behålla nuvarande)</small><input type="password" minLength={12} value={account.password ?? ""} onChange={(e) => setAccountUsers((all) => all.map((a) => a.id === account.id ? { ...a, password: e.target.value } : a))} placeholder="Minst 12 tecken"/></label>
                    <PermissionMatrix value={account.permissions} disabled={saving} onChange={(area, action, checked) => setAccountUsers((all) => all.map((a) => a.id === account.id ? { ...a, permissions: updatePermissions(a.permissions, area, action, checked) } : a))}/>
                    <button className="button button-outline" disabled={saving}>Spara ändringar</button>
                  </form></details>
                  <button className={account.active ? "account-toggle" : "account-toggle reactivate"} disabled={saving} onClick={() => { if (!account.active || window.confirm(`Stänga av ${account.name}? Inloggningen avslutas direkt.`)) void saveAccount("setUserActive", { userId: account.id, active: !account.active }, account.active ? "Kontot är avstängt." : "Kontot är aktiverat igen."); }}>{account.active ? "Stäng av konto" : "Aktivera konto"}</button>
                </>}
              </article>)}</div> : <div className="simple-empty">Inga konton ännu. Skapa det första med formuläret.</div>}
            </section>
          </div>
        </>}

        {tab === "lag" && <>
          <div className="page-heading"><div><p className="eyebrow">GRUNDUPPGIFTER</p><h1>Lag & spelare</h1><p className="subheading">Lägg upp sporter, lag och hela truppen en gång. Välj matchtrupp inför varje match.</p></div></div>
          <div className="setup-grid">
            <section className="panel"><div className="panel-heading"><span className="panel-icon"><Shield size={17}/></span><div><h2>Sporter & lag</h2><p>Organisera efter sport och åldersgrupp.</p></div></div>
              {can("teams","create") ? <><form className="inline-form" onSubmit={addSport}><input aria-label="Ny sport" value={sportName} onChange={(e) => setSportName(e.target.value)} placeholder="Ny sport, t.ex. Fotboll"/><button className="button button-primary" disabled={saving}><Plus size={16}/>Lägg till</button></form>
              {data.sports.length > 0 && <div className="sport-admin-list">{data.sports.map((sport) => <div className="sport-admin-row" key={sport.id}><span>{sport.name}</span><div className="row-actions">{can("teams","edit") && <button className="delete-player" title={`Byt namn på ${sport.name}`} onClick={() => { const name = window.prompt("Sportens namn", sport.name); if (name?.trim()) void run({ action: "updateSport", sportId: sport.id, name }, "Sportens namn är uppdaterat."); }}><Pencil size={14}/></button>}{can("teams","delete") && <button className="delete-player" title={`Ta bort ${sport.name}`} onClick={() => { if (window.confirm(`Ta bort sporten ${sport.name}? Det går bara om den inte används av något lag.`)) void run({ action: "deleteSport", sportId: sport.id }, "Sporten är borttagen."); }}><Trash2 size={14}/></button>}</div></div>)}</div>}
              <form className="form-stack compact" onSubmit={addTeam}><label>Sport<select required value={teamForm.sportId} onChange={(e) => setTeamForm((f) => ({ ...f, sportId: e.target.value }))}><option value="">Välj sport</option>{data.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><div className="form-row"><label>Åldersgrupp<input value={teamForm.groupName} onChange={(e) => setTeamForm((f) => ({ ...f, groupName: e.target.value }))} placeholder="Exempel: P10"/></label><label>Lagnamn<input required value={teamForm.name} onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))} placeholder="Exempel: Blå"/></label></div><button className="button button-outline full-button" disabled={saving || !data.sports.length}><Plus size={15}/>Lägg till lag</button>{!data.sports.length && <p className="form-hint">Lägg till en sport först.</p>}</form></> : <p className="permission-note">Du kan se laguppgifterna men saknar behörighet att skapa sporter eller lag.</p>}
              <div className="team-list">{data.teams.filter((t) => t.active === 1).map((t) => <div key={t.id} className={setupTeamId === String(t.id) ? "team-row active" : "team-row"}><button className="team-row-select" onClick={() => setSetupTeamId(String(t.id))}><span className="team-avatar">{t.name.slice(0,1).toUpperCase()}</span><span><b>{t.name}{t.groupName ? ` · ${t.groupName}` : ""}</b><small>{t.sportName ?? data.sports.find((s) => s.id === t.sportId)?.name} · {data.players.filter((p) => p.teamId === t.id && p.active === 1).length} spelare</small></span><ChevronDown size={15}/></button><div className="team-actions">{can("teams","edit") && <button className="delete-player" title={`Redigera ${t.name}`} onClick={() => { const name = window.prompt("Lagnamn", t.name); if (name === null) return; const groupName = window.prompt("Åldersgrupp", t.groupName); if (groupName !== null) void run({ action: "updateTeam", teamId: t.id, name, groupName }, "Laguppgifterna är uppdaterade."); }}><Pencil size={14}/></button>}{can("teams","delete") && <button className="delete-player" title={`Ta bort ${t.name}`} onClick={() => { if (window.confirm(`Ta bort ${t.name} från de aktiva listorna? Matchhistoriken sparas.`)) void run({ action: "deleteTeam", teamId: t.id }, "Laget har tagits bort från de aktiva listorna."); }}><Trash2 size={14}/></button>}</div></div>)}</div>
            </section>
            <section className="panel players-panel"><div className="panel-heading"><span className="panel-icon soft"><Users size={17}/></span><div><h2>Spelartrupp</h2><p>{setupTeamId ? (data.teams.find((t) => String(t.id) === setupTeamId)?.name ?? "Valt lag") : "Välj ett lag för att hantera spelare."}</p></div></div>
              <label className="team-select-label">Aktivt lag<select value={setupTeamId} onChange={(e) => { setSetupTeamId(e.target.value); setPlayerForm((f) => ({ ...f, teamId: e.target.value })); }}><option value="">Välj lag</option>{data.teams.filter((t) => t.active === 1).map((t) => <option key={t.id} value={t.id}>{t.name}{t.groupName ? ` · ${t.groupName}` : ""}</option>)}</select></label>
              {can("players","create") ? <form className="add-player-form" onSubmit={addPlayer}><input type="hidden" value={setupTeamId} readOnly/><label className="sr-only" htmlFor="player-name">Spelarens namn</label><input id="player-name" required value={playerForm.name} onChange={(e) => setPlayerForm((f) => ({ ...f, teamId: setupTeamId, name: e.target.value }))} placeholder="Spelarens namn"/><label className="sr-only" htmlFor="player-number">Tröjnummer</label><input id="player-number" inputMode="numeric" value={playerForm.number} onChange={(e) => setPlayerForm((f) => ({ ...f, teamId: setupTeamId, number: e.target.value.replace(/\D/g, "").slice(0,3) }))} placeholder="#"/><button className="button button-primary" disabled={saving || !setupTeamId}><Plus size={15}/>Lägg till</button></form> : <p className="permission-note">Du kan se truppen men saknar behörighet att lägga till spelare.</p>}
              <div className="roster-list">{teamPlayers.length ? [...teamPlayers].sort((a,b) => (a.number ?? 999) - (b.number ?? 999)).map((p) => <div className="roster-row" key={p.id}><span className="jersey">{p.number ?? "–"}</span><span>{p.name}</span><div className="row-actions">{can("players","edit") && <button className="delete-player" title={`Redigera ${p.name}`} onClick={() => { const name = window.prompt("Spelarens namn", p.name); if (name === null) return; const number = window.prompt("Tröjnummer (lämna tomt om spelaren saknar nummer)", p.number === null ? "" : String(p.number)); if (number !== null) void run({ action: "updatePlayer", playerId: p.id, name, number: number.trim() ? Number(number) : null }, "Spelaruppgifterna är uppdaterade."); }}><Pencil size={14}/></button>}{can("players","delete") && <button className="delete-player" title={`Ta bort ${p.name}`} onClick={() => { if (window.confirm(`Ta bort ${p.name} ur laget?`)) void run({ action: "deletePlayer", playerId: p.id }, "Spelaren är borttagen."); }}><Trash2 size={14}/></button>}</div></div>) : <div className="simple-empty">{setupTeamId ? "Ingen spelare tillagd ännu." : "Välj ett lag ovan för att lägga till spelare."}</div>}</div>
              {teamPlayers.length > 0 && <p className="form-hint">Spelarnamnen blir tryckknappar vid matchstart. Tryck för att registrera mål.</p>}
            </section>
          </div>
        </>}
      </div>
      <footer className="footer"><span>Matchkollen</span><span>Enkel koll på varje match</span></footer>
    </main>
  );
}

function PermissionMatrix({ value, disabled, onChange }: { value: Permissions; disabled?: boolean; onChange: (area: keyof Permissions, action: "create" | "edit" | "delete", checked: boolean) => void }) {
  const actions = [{ key: "create", label: "Lägg till" }, { key: "edit", label: "Ändra" }, { key: "delete", label: "Ta bort" }] as const;
  return <div className="permission-matrix-wrap"><table className="permission-matrix"><thead><tr><th>Område</th>{actions.map((action) => <th key={action.key}>{action.label}</th>)}</tr></thead><tbody>{permissionLabels.map((area) => <tr key={area.key}><th scope="row">{area.label}</th>{actions.map((action) => <td key={action.key}><label><input type="checkbox" disabled={disabled} checked={value[area.key][action.key]} aria-label={`${area.label}: ${action.label}`} onChange={(event) => onChange(area.key, action.key, event.target.checked)}/></label></td>)}</tr>)}</tbody></table></div>;
}

async function togglePlayerFor(matchId: number, playerId: number, checked: boolean, run: (action: Record<string, unknown>) => Promise<void>) {
  await run({ action: checked ? "removeParticipant" : "addParticipant", matchId, playerId });
}
