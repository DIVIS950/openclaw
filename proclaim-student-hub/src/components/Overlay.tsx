import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Open overlays, newest last: only the top one keeps the keyboard.
const stack: HTMLElement[] = [];
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Draws a sheet on top of the whole app, not inside the card or section that
 * opened it: a parent with an animation (a transform) would otherwise squeeze
 * the sheet into that parent's box. With a keyboard it also acts as a dialog:
 * focus moves in (the first field on a laptop, the sheet itself on a phone so
 * no keyboard pops up), Tab stays inside, and focus goes back on close.
 */
export function Overlay({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  // The button that opened the sheet, read while rendering: by the time the
  // effect runs, a field's autoFocus may already have moved focus inside.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    const box = root.current;
    if (!box) {
      return;
    }
    stack.push(box);
    const dialog =
      box.querySelector<HTMLElement>('[role="dialog"]') ?? box.querySelector<HTMLElement>(".sheet");
    dialog?.setAttribute("aria-modal", "true");
    if (dialog && !dialog.hasAttribute("tabindex")) {
      dialog.tabIndex = -1;
    }
    if (!box.contains(document.activeElement)) {
      const laptop = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches;
      // The first field that can really take focus: not hidden, not a file picker.
      const field = laptop
        ? ([
            ...box.querySelectorAll<HTMLElement>(
              'input:not([type="hidden"]):not([type="file"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
            ),
          ].find((el) => el.offsetParent !== null) ?? null)
        : null;
      (field ?? dialog)?.focus({ preventScroll: true });
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || stack[stack.length - 1] !== box) {
        return;
      }
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!box.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (at === first || at === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(box), 1);
      // Back to the button that opened the sheet, if it's still there.
      if (opener instanceof HTMLElement && opener !== document.body && document.contains(opener)) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  return createPortal(
    <div ref={root} style={{ display: "contents" }}>
      {children}
    </div>,
    document.querySelector(".app") ?? document.body,
  );
}
