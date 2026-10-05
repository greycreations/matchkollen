"use client";

import { useEffect, useRef, useState } from "react";
import { sportAvatars } from "@/lib/sport-avatars";

// These authenticated, already resized JPEGs must bypass public image optimization caches.
/* eslint-disable @next/next/no-img-element */

export function Avatar({ kind, id, name, revision = 0 }: { kind: "player" | "user"; id: number; name: string; revision?: number }) {
  return <span className="profile-avatar">{name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}{revision > 0 && <img key={revision} src={`/api/photos?kind=${kind}&id=${id}&v=${revision}`} alt={`Profilbild för ${name}`} onError={(event) => { event.currentTarget.style.display = "none"; }}/>}</span>;
}

export function PhotoEditor({ kind, id, name, revision = 0, onSaved }: { kind: "player" | "user"; id: number; name: string; revision?: number; onSaved?: () => void | Promise<void> }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentRevision, setRevision] = useState(revision);
  const [message, setMessage] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; initialX: number; initialY: number } | null>(null);
  useEffect(() => {
    if (!image || !canvas.current) return;
    const context = canvas.current.getContext("2d");
    if (!context) return;
    const scale = Math.max(256 / image.naturalWidth, 256 / image.naturalHeight) * zoom;
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.fillStyle = "#fff"; context.fillRect(0, 0, 256, 256);
    context.drawImage(image, (256 - width) / 2 + x * (width - 256) / 2, (256 - height) / 2 + y * (height - 256) / 2, width, height);
  }, [image, zoom, x, y]);
  async function select(file?: File) {
    setError(""); setMessage(""); setImage(null);
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("Välj JPEG, PNG eller WebP, högst 10 MB."); return; }
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      URL.revokeObjectURL(url);
      if (next.naturalWidth * next.naturalHeight > 24000000) { setError("Bilden är för stor. Välj högst 24 megapixlar."); return; }
      setZoom(1); setX(0); setY(0); setImage(next);
    };
    next.onerror = () => { URL.revokeObjectURL(url); setError("Bilden kunde inte öppnas."); };
    next.src = url;
  }
  function selectAvatar(src: string) {
    setError(""); setMessage(""); setImage(null);
    const next = new Image();
    next.onload = () => { setZoom(1); setX(0); setY(0); setImage(next); };
    next.onerror = () => setError("Sportavataren kunde inte öppnas.");
    next.src = src;
  }
  async function save(remove = false) {
    if (!remove && !canvas.current) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const photo = remove ? null : canvas.current!.toDataURL("image/jpeg", .85).split(",")[1];
      const response = await fetch("/api/photos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id, photo }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Bilden kunde inte sparas.");
      setRevision(remove ? 0 : Math.max(currentRevision, revision) + 1); setImage(null); setMessage(remove ? "Profilbilden är borttagen." : "Profilbilden är sparad.");
      await onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Bilden kunde inte sparas."); }
    finally { setSaving(false); }
  }
  return <details className="photo-editor"><summary><Avatar kind={kind} id={id} name={name} revision={currentRevision}/><span>Profilbild · {name}</span></summary><div className="photo-controls">
    <details className="sport-avatar-picker"><summary>Välj en rolig sportavatar · 20 bilder</summary><p>Välj en maskot, kontrollera förhandsvisningen och klicka på Spara bild.</p>{["Fotboll", "Innebandy"].map((sport) => <section key={sport}><h3>{sport}</h3><div className="sport-avatar-grid">{sportAvatars.filter((avatar) => avatar.sport === sport).map((avatar) => <button type="button" key={avatar.id} title={avatar.name} aria-label={`Välj ${avatar.name}`} disabled={saving} onClick={() => selectAvatar(avatar.src)}><img src={avatar.src} alt=""/><span>{avatar.name.split(" · ")[0]}</span></button>)}</div></section>)}</details>
    <label>Välj bild<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={(event) => { void select(event.target.files?.[0]); event.target.value = ""; }}/></label>
    {image && <><p>Dra bilden eller använd reglagen för att centrera ansiktet. Den runda förhandsvisningen visar hur bilden blir.</p><canvas ref={canvas} width={256} height={256} aria-label={`Förhandsvisning av profilbild för ${name}`} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, initialX: x, initialY: y }; }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerMove={(event) => {
      if (!drag.current || saving) return;
      const scale = Math.max(256 / image.naturalWidth, 256 / image.naturalHeight) * zoom;
      const ratio = 256 / event.currentTarget.getBoundingClientRect().width;
      const dx = (image.naturalWidth * scale - 256) / 2, dy = (image.naturalHeight * scale - 256) / 2;
      setX(dx > 0 ? Math.max(-1, Math.min(1, drag.current.initialX + (event.clientX - drag.current.x) * ratio / dx)) : 0);
      setY(dy > 0 ? Math.max(-1, Math.min(1, drag.current.initialY + (event.clientY - drag.current.y) * ratio / dy)) : 0);
    }}/><label>Zoom<input type="range" min="1" max="4" step="0.01" value={zoom} disabled={saving} onChange={(event) => setZoom(Number(event.target.value))}/></label><label>Horisontell centrering<input type="range" min="-1" max="1" step="0.01" value={x} disabled={saving} onChange={(event) => setX(Number(event.target.value))}/></label><label>Vertikal centrering<input type="range" min="-1" max="1" step="0.01" value={y} disabled={saving} onChange={(event) => setY(Number(event.target.value))}/></label><div className="photo-buttons"><button type="button" className="button button-outline" disabled={saving} onClick={() => { setZoom(1); setX(0); setY(0); }}>Centrera igen</button><button type="button" className="button button-primary" disabled={saving} onClick={() => void save()}>Spara bild</button><button type="button" className="button button-outline" disabled={saving} onClick={() => setImage(null)}>Avbryt</button></div></>}
    {currentRevision > 0 && <button type="button" className="button button-outline" disabled={saving} onClick={() => void save(true)}>Ta bort profilbild</button>}
    {saving && <p role="status">Sparar bilden …</p>}{message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </div></details>;
}
