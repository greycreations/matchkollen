"use client";
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";

const key = "matchkollen-period-colors";
const event = "matchkollen-period-colors-changed";
const defaults = ["#2783c6", "#c27c00", "#8752c6"];
let temporary = "", temporaryOnly = false;
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(event, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(event, callback); };
}
function snapshot() { try { return temporaryOnly ? temporary : localStorage.getItem(key) ?? ""; } catch { return temporary; } }
function store(value: string) {
  temporary = value;
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); temporaryOnly = false; }
  catch { temporaryOnly = true; }
  window.dispatchEvent(new Event(event));
  return !temporaryOnly;
}
const ColorContext = createContext<string[] | null>(null);
export function PeriodColorProvider({ children }: { children: React.ReactNode }) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const colors = useMemo(() => {
    try { const parsed: unknown = JSON.parse(raw); return Array.isArray(parsed) && parsed.length === 3 && parsed.every((value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) ? parsed as string[] : null; } catch { return null; }
  }, [raw]);
  useEffect(() => {
    for (let index = 0; index < 3; index++) { const property = `--period-${index + 1}-custom`; if (colors) document.documentElement.style.setProperty(property, colors[index]); else document.documentElement.style.removeProperty(property); }
  }, [colors]);
  return <ColorContext.Provider value={colors}>{children}</ColorContext.Provider>;
}

export function PeriodColorSettings({ themePicker }: { themePicker: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const palette = resolvedTheme === "dark" ? ["#76c5fa", "#efb343", "#c29af7"] : defaults;
  const colors = useContext(ColorContext);
  const [message, setMessage] = useState("");
  return <section className="panel settings-panel period-color-settings"><h2>Färger & utseende</h2>{themePicker}<p>Välj färg för varje period. Samma färger används i Historik och Statistik, även för halvlekar. Valen gäller den här webbläsaren och ingår inte i databasbackupen.</p><div className="period-color-options">{palette.map((defaultColor, index) => <label key={index}>Period / halvlek {index + 1}<input type="color" aria-label={`Färg för period ${index + 1}`} value={colors?.[index] ?? defaultColor} onChange={(change) => { const updated = [...(colors ?? palette)]; updated[index] = change.target.value; const saved = store(JSON.stringify(updated)); setMessage(saved ? "Färgerna är sparade och används direkt." : "Färgerna används nu, men webbläsaren tillåter inte att de sparas."); }}/><code>{colors?.[index] ?? defaultColor}</code></label>)}</div><button className="button button-outline" onClick={() => { const saved = store(""); setMessage(saved ? "Standardfärgerna är återställda. De anpassas till ljust eller mörkt tema." : "Standardfärgerna är återställda för denna visning."); }}>Återställ standardfärger</button><p className="form-hint">Rubriker och periodnummer finns kvar oavsett färgval. Standardfärgerna anpassas till mörkt tema.</p>{message && <p role="status">{message}</p>}</section>;
}
