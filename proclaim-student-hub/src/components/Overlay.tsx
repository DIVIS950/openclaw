import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Draws a sheet on top of the whole app, not inside the card or section that
 * opened it: a parent with an animation (a transform) would otherwise squeeze
 * the sheet into that parent's box.
 */
export function Overlay({ children }: { children: ReactNode }) {
  return createPortal(children, document.querySelector(".app") ?? document.body);
}
