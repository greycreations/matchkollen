"use client";

import { useSyncExternalStore } from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

const subscribe = () => () => {};

export function AppTheme({ children }: { children: React.ReactNode }) {
  return <ThemeProvider attribute="data-theme" storageKey="matchkollen-theme" defaultTheme="system" enableSystem>{children}</ThemeProvider>;
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const value = mounted ? theme ?? "system" : "system";
  const Icon = value === "dark" ? Moon : value === "light" ? Sun : Monitor;
  return <label className="theme-picker"><Icon size={14} aria-hidden="true"/><span className="sr-only">Färgtema</span><select aria-label="Färgtema" value={value} disabled={!mounted} onChange={(event) => setTheme(event.target.value)}><option value="light">Ljust</option><option value="dark">Mörkt</option><option value="system">System</option></select></label>;
}
