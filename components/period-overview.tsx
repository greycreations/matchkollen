import { eventTime, goalScores, periodTotals, type PeriodCard, type PeriodGoal, type PeriodMatch } from "@/lib/period-stats";

export function PeriodOverview({ matches, goals, cards, history, homeName = "Vårt lag", awayName = "Motståndare", unit = "Period", onEditGoal, onDeleteEvent }: { matches: PeriodMatch[]; goals: PeriodGoal[]; cards?: PeriodCard[]; history?: boolean; homeName?: string; awayName?: string; unit?: string; onEditGoal?: (goal: PeriodGoal) => void; onDeleteEvent?: (kind: "goal" | "card", id: number) => void }) {
  const scores = goalScores(goals);
  return <section className="panel period-overview"><h2>{history ? "Matchhistorik · alla händelser" : "Mål per period"}</h2><p className="form-hint">{history ? "Öppna varje period för alla mål och kort. Lag och ställning visas vid händelsen." : "Gjorda och insläppta mål för valt urval. Matchformaten sammanställs separat."}</p>
    {[2, 3].filter((format) => matches.some((match) => match.periods === format)).map((format) => {
      const result = periodTotals(matches, goals, format);
      const scale = Math.max(1, ...result.periods.flatMap((period) => [period.home, period.away]));
      const label = history ? unit[0].toLocaleUpperCase("sv") + unit.slice(1) : format === 2 ? "Halvlek / period" : "Period";
      return <div className="period-format" key={format}>
        {!history && <h3>{format === 2 ? "Matcher med 2 halvlekar / perioder" : "Matcher med 3 perioder"} · {result.matchCount} {result.matchCount === 1 ? "match" : "matcher"}</h3>}
        {result.periods.map((period) => {
          const entries = [
            ...goals.filter((goal) => goal.period === period.period).map((goal) => ({ ...goal, kind: "goal" as const })),
            ...(cards ?? []).filter((card) => card.period === period.period).map((card) => ({ ...card, kind: "card" as const })),
          ].sort((a, b) => eventTime(a.createdAt) - eventTime(b.createdAt) || (a.kind === b.kind ? a.id - b.id : a.kind === "goal" ? -1 : 1));
          const summary = <><span className="period-heading"><i/>{label} {period.period}</span><span className="period-score">{period.home}–{period.away}</span></>;
          const bars = <div className="period-bars"><div><span>Gjorda mål</span><div className="period-track"><i style={{ width: `${period.home / scale * 100}%` }}/></div><b>{period.home}</b></div><div><span>Insläppta mål</span><div className="period-track"><i className="period-away-bar" style={{ width: `${period.away / scale * 100}%`, display: period.away ? "block" : "none" }}/></div><b>{period.away}</b></div><small>{period.share} % av våra mål</small></div>;
          return history ? <div className={`period-block period-${period.period}`} key={period.period}><div className="period-summary">{summary}<span>{entries.length} händelser</span></div>{bars}<details className="period-event-details"><summary>Visa alla {entries.length} händelser i {label.toLocaleLowerCase("sv")} {period.period}</summary><ol className="period-events">{entries.map((event) => {
            const ours = event.kind === "card" || event.side === "home";
            return <li key={`${event.kind}-${event.id}`}><span className="period-event-type">{event.kind === "goal" ? "Mål" : event.cardType === "red" ? "Rött kort" : event.cardType === "yellow" ? "Gult kort" : "Grönt kort"}</span><strong>{event.playerName || (ours ? homeName : awayName)}{event.number !== null ? ` · #${event.number}` : ""}</strong><span className={`event-team-badge ${ours ? "our-team" : "opponent-team"}`}>{ours ? homeName : awayName} · {ours ? "Vårt lag" : "Motståndare"}</span>{event.kind === "goal" && <b className="historical-score" aria-label={`Ställning: ${homeName} ${scores.get(event.id)} ${awayName}`}>{homeName} {scores.get(event.id)} {awayName}</b>}{event.kind === "goal" && onEditGoal && <button type="button" className="button button-outline" onClick={() => onEditGoal(event)}>Redigera</button>}{onDeleteEvent && <button type="button" className="button button-outline" onClick={() => onDeleteEvent(event.kind, event.id)} aria-label={`Ta bort ${event.kind === "goal" ? "mål" : "kort"} för ${event.playerName || (ours ? homeName : awayName)}`}>Ta bort</button>}</li>;
          })}{!entries.length && <li>Inga händelser i denna period.</li>}</ol></details></div> : <div className={`period-block period-${period.period}`} key={period.period}><div className="period-summary">{summary}</div>{bars}</div>;
        })}
      </div>;
    })}
    <p className="form-hint">Fyllda staplar: gjorda mål. Konturer: insläppta mål. Ingen matchminut registreras.</p>
  </section>;
}
