type HistoryCard = { id: number; matchId: number; period: number; cardType: "red" | "yellow" | "green"; playerName: string | null; number: number | null; createdAt: string };
type HistoryMatch = { id: number; teamId: number; homeName: string; opponent: string; scheduledAt: string; competitionName?: string | null };
type HistoryTeam = { id: number; name: string; sportName?: string };

const cardNames = { red: "Rött kort", yellow: "Gult kort", green: "Grönt kort" };
const matchDate = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" });
const recordedDate = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });

export function CardHistory({ cards, matches, teams }: { cards: HistoryCard[]; matches: HistoryMatch[]; teams: HistoryTeam[] }) {
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const entries = cards.filter((card) => matchById.has(card.matchId)).sort((a, b) => matchById.get(b.matchId)!.scheduledAt.localeCompare(matchById.get(a.matchId)!.scheduledAt) || b.id - a.id);
  return <details className="card-history">
    <summary className="button button-outline">Detaljerad historik <span>({entries.length} kort)</span></summary>
    <p className="form-hint">Visar kort för valt urval av sport, lag, cup och match. Senaste matchdatum först. Registreringstid visas i svensk tid.</p>
    {entries.length ? <ul className="card-history-list">{entries.map((card) => {
      const match = matchById.get(card.matchId)!;
      const team = teams.find((item) => item.id === match.teamId);
      // SQL timestamps without an offset are stored in UTC.
      const recordedAt = card.createdAt.endsWith("Z") || /[+-]\d\d:\d\d$/.test(card.createdAt) ? card.createdAt : card.createdAt.replace(" ", "T") + "Z";
      return <li key={card.id}>
        <div className="card-history-player"><strong>{card.playerName || "Borttagen spelare"}{card.number !== null ? ` · #${card.number}` : ""}</strong><span className="card-history-type"><i className={`card-swatch ${card.cardType}-swatch`}/>{cardNames[card.cardType]}</span></div>
        <div><strong>{match.homeName || team?.name} – {match.opponent}</strong><small>{team?.sportName} · {team?.name}{match.competitionName ? ` · ${match.competitionName}` : ""}</small></div>
        <div><span>Matchdatum: <time dateTime={match.scheduledAt}>{matchDate.format(new Date(match.scheduledAt))}</time></span><small>Period {card.period}</small><small>Registrerat: <time dateTime={recordedAt}>{recordedDate.format(new Date(recordedAt))}</time></small></div>
      </li>;
    })}</ul> : <p className="chart-empty">Inga kort i det valda urvalet.</p>}
  </details>;
}
