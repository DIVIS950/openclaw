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
