import { useQueryClient } from "@tanstack/react-query";
import { Camera, Minus, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Sheet } from "./Sheet";
import { Avatar, Button } from "./ui";
import { tr } from "@/lib/i18n";

const VIEW = 272; // size of the crop window in px
const OUT = 384; // stored resolution (square)

/**
 * Upload a profile photo: pick an image, position it in the circle (drag + zoom), done.
 * Cropping and resizing happen in the browser – only ~50 KB reach the server.
 */
export function AvatarEditor({
  name,
  color,
  src,
  endpoint,
  size = 72,
  onSaved,
}: {
  name: string;
  color: string;
  src: string | null;
  /** e.g. /api/me/avatar or /api/admin/users/:id/avatar */
  endpoint: string;
  size?: number;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    for (const k of ["me", "users", "admin-users", "home", "user"]) qc.invalidateQueries({ queryKey: [k] });
    onSaved?.();
  };

  async function remove() {
    if (!window.confirm(tr("Remove profile photo? The initials will be shown again.", "Profilfoto entfernen? Dann erscheinen wieder die Initialen."))) return;
    setBusy(true);
    try {
      await api.del(endpoint);
      refresh();
      toast.success(tr("Profile photo removed", "Profilfoto entfernt"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        aria-label={src ? tr("Change profile photo", "Profilfoto ändern") : tr("Upload profile photo", "Profilfoto hochladen")}
      >
        <Avatar name={name} color={color} src={src} size={size} />
        <span className="absolute inset-0 grid place-items-center rounded-full bg-[#05224B]/55 text-white opacity-0 transition group-hover:opacity-100">
          <Camera className="h-5 w-5" />
        </span>
      </button>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Camera className="h-4 w-4" />} onClick={() => input.current?.click()} loading={busy && !file}>
          {src ? tr("Change photo", "Foto ändern") : tr("Upload photo", "Foto hochladen")}
        </Button>
        {src && (
          <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={remove} disabled={busy}>
            {tr("Remove", "Entfernen")}
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 20 * 1024 * 1024) return toast.error(tr("The image is larger than 20 MB.", "Das Bild ist größer als 20 MB."));
          setFile(f);
        }}
      />
      <CropDialog
        file={file}
        onClose={() => setFile(null)}
        onDone={async (blob) => {
          setBusy(true);
          try {
            await api.put(endpoint, blob);
            refresh();
            toast.success(tr("Profile photo saved", "Profilfoto gespeichert"));
            setFile(null);
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        busy={busy}
      />
    </div>
  );
}

function CropDialog({ file, onClose, onDone, busy }: { file: File | null; onClose: () => void; onDone: (b: Blob) => void; busy: boolean }) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      setImg(im);
      setZoom(1);
      const s = VIEW / Math.min(im.naturalWidth, im.naturalHeight);
      setPos({ x: (VIEW - im.naturalWidth * s) / 2, y: (VIEW - im.naturalHeight * s) / 2 });
    };
    im.onerror = () => {
      toast.error(tr("The browser can't open this image. Please choose a JPG or PNG.", "Dieses Bild kann der Browser nicht öffnen. Bitte ein JPG oder PNG wählen."));
      onClose();
    };
    im.src = u;
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setImg(null);
      setUrl(null);
    };
  }, [file, onClose]);

  const base = img ? VIEW / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = base * zoom;
  const clamp = (p: { x: number; y: number }, s = scale) =>
    img
      ? {
          x: Math.min(0, Math.max(VIEW - img.naturalWidth * s, p.x)),
          y: Math.min(0, Math.max(VIEW - img.naturalHeight * s, p.y)),
        }
      : p;

  const setZoomKeepCenter = (z: number) => {
    const nz = Math.min(4, Math.max(1, z));
    const ns = base * nz;
    // keep the image point at the window center in the center
    const cx = (VIEW / 2 - pos.x) / scale;
    const cy = (VIEW / 2 - pos.y) / scale;
    setZoom(nz);
    setPos(clamp({ x: VIEW / 2 - cx * ns, y: VIEW / 2 - cy * ns }, ns));
  };

  async function save() {
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, -pos.x / scale, -pos.y / scale, VIEW / scale, VIEW / scale, 0, 0, OUT, OUT);
    let q = 0.88;
    let blob: Blob | null = null;
    while (q > 0.5) {
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
      if (blob && blob.size < 350 * 1024) break;
      q -= 0.1;
    }
    if (blob) onDone(blob);
  }

  return (
    <Sheet open={!!file} onOpenChange={(v) => !v && onClose()} title={tr("Position photo", "Foto ausrichten")} variant="dialog">
      <div className="space-y-4">
        <div className="flex justify-center">
          <div
            className="relative cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-surface2 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            tabIndex={0}
            role="application"
            aria-label={tr("Image crop. Move with the arrow keys, zoom with plus and minus.", "Bildausschnitt. Mit den Pfeiltasten verschieben, mit Plus und Minus zoomen.")}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onWheel={(e) => setZoomKeepCenter(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}
            onKeyDown={(e) => {
              const step = 12;
              const m: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
              if (m[e.key]) {
                e.preventDefault();
                setPos(clamp({ x: pos.x + m[e.key]![0], y: pos.y + m[e.key]![1] }));
              } else if (e.key === "+" || e.key === "=") setZoomKeepCenter(zoom + 0.15);
              else if (e.key === "-") setZoomKeepCenter(zoom - 0.15);
            }}
          >
            {url && img && (
              <img
                src={url}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 max-w-none origin-top-left"
                style={{ width: img.naturalWidth, height: img.naturalHeight, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
              />
            )}
            {/* Circle mask */}
            <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_999px_rgba(8,27,59,0.55)]" />
            <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/80" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface2" onClick={() => setZoomKeepCenter(zoom - 0.2)} aria-label={tr("Zoom out", "Verkleinern")}>
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="range"
            min={1}
            max={4}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoomKeepCenter(Number(e.target.value))}
            className="flex-1 accent-[rgb(var(--brand))]"
            aria-label="Zoom"
          />
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full hover:bg-surface2" onClick={() => setZoomKeepCenter(zoom + 0.2)} aria-label={tr("Zoom in", "Vergrößern")}>
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <p className="text-center text-[12.5px] text-muted">{tr("Drag to move. The whole team will see this photo.", "Ziehen zum Verschieben. Das Foto sieht das ganze Team.")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {tr("Cancel", "Abbrechen")}
          </Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!img}>
            {tr("Save photo", "Foto speichern")}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
