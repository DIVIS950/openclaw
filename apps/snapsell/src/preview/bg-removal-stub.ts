// The preview can't download the cut-out model (the page may only load its own files),
// so the White preset explains itself instead.
export async function removeBackground(): Promise<Blob> {
  throw new Error("The white cut-out runs in the full app. Try Auto or Vivid here.");
}
