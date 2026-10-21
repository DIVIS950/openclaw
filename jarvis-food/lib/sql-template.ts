/** Turns a tagged template into `$1, $2, ...` placeholders plus a params array. */
export function buildQuery(
  strings: TemplateStringsArray | readonly string[],
  values: readonly unknown[],
): { text: string; params: unknown[] } {
  let text = strings[0] ?? "";
  for (let i = 1; i < strings.length; i++) {
    text += `$${i}${strings[i]}`;
  }
  return { text, params: [...values] };
}
