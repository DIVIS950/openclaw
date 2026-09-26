type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
const w = window as unknown as { claude?: { use: (name: string) => Promise<unknown> } };

/**
 * Saves a file to the viewer's device. On the Claude page the viewer confirms each save
 * (the page's `downloads` capability); elsewhere it's a normal browser download.
 * Returns false when the viewer declined or saving isn't possible.
 */
export async function saveFile(filename: string, data: Blob) {
  if (w.claude) {
    const downloads = (await w.claude.use("downloads").catch(() => null)) as Downloads | null;
    if (!downloads) return false;
    try {
      await downloads.save({ filename, data });
      return true;
    } catch {
      return false;
    }
  }
  const url = URL.createObjectURL(data);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/**
 * Saves several photos. On an iPhone the share sheet's "Save Images" puts them all in Photos in one
 * go, which is where the Vinted and Facebook apps pick photos from.
 */
export async function savePhotos(files: { name: string; blob: Blob }[]) {
  if (!w.claude) {
    const list = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || "image/jpeg" }));
    if (navigator.canShare?.({ files: list })) {
      try {
        await navigator.share({ files: list });
        return true;
      } catch (e) {
        // The viewer closed the sheet: nothing saved, but nothing broken either.
        if ((e as Error).name === "AbortError") return false;
      }
    }
  }
  let ok = true;
  for (const f of files) ok = (await saveFile(f.name, f.blob)) && ok;
  return ok;
}
