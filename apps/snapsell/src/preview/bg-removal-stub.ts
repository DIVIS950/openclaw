// Pages that can't download the cut-out model (they may only load their own files) throw here,
// and the White preset falls back to the free plain-background cut-out.
export async function removeBackground(): Promise<Blob> {
  throw new Error("Cut-out model unavailable here");
}
