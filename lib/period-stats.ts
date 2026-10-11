export type PeriodGoal = { id: number; matchId: number; period: number; side: "home" | "away"; playerName: string | null; number: number | null; createdAt: string };
export type PeriodCard = { id: number; matchId: number; period: number; cardType: "red" | "yellow" | "green"; playerName: string | null; number: number | null; createdAt: string };
export type PeriodMatch = { id: number; periods: number };

export function periodTotals(matches: PeriodMatch[], goals: PeriodGoal[], format: number) {
  const ids = new Set(matches.filter((match) => match.periods === format).map((match) => match.id));
  const selected = goals.filter((goal) => ids.has(goal.matchId));
  const totalHome = selected.filter((goal) => goal.side === "home").length;
  return { matchCount: ids.size, periods: Array.from({ length: format }, (_, index) => {
    const period = index + 1;
    const home = selected.filter((goal) => goal.period === period && goal.side === "home").length;
    const away = selected.filter((goal) => goal.period === period && goal.side === "away").length;
    return { period, home, away, share: totalHome ? Math.round(home / totalHome * 100) : 0 };
  }) };
}

export function goalScores(goals: PeriodGoal[]) {
  let home = 0, away = 0;
  return new Map([...goals].sort((a, b) => a.period - b.period || a.id - b.id).map((goal) => {
    if (goal.side === "home") home++; else away++;
    return [goal.id, `${home}–${away}`];
  }));
}

export function eventTime(value: string) {
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value.replace(" ", "T") + "Z").getTime();
}
