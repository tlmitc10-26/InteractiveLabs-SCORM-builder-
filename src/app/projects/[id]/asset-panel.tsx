"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function AssetPanel({ projectId, assets }: {
  projectId: string;
  assets: Array<{ id: string; filename: string; mimeType: string; byteSize: number }>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true); setError(null);
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", file);
    const res = await fetch("/api/assets", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Upload failed"); return; }
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  return (
    <section className="mt-8">
      <h2 className="font-semibold">Images (backgrounds and state images)</h2>
      <div className="mt-2 flex items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" />
        <button onClick={upload} disabled={busy} className="rounded bg-[#8C1D40] px-3 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? "Uploading…" : "Upload"}
        </button>
      </div>
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {assets.map((a) => (
          <li key={a.id} className="rounded border border-gray-200 bg-white p-2 text-xs">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/assets/${a.id}`} alt={a.filename} className="h-24 w-full rounded object-contain bg-gray-50" />
            <p className="mt-1 truncate font-medium">{a.filename}</p>
            <p className="text-gray-400">{Math.round(a.byteSize / 1024)} KB · id: <code className="select-all">{a.id}</code></p>
          </li>
        ))}
        {assets.length === 0 && <li className="col-span-full text-sm text-gray-500">No images uploaded yet.</li>}
      </ul>
    </section>
  );
}
