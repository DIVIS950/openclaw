// The phone keyboard: when it opens, iOS and Android shrink the visible part
// of the page, and iPhone also slides the visible part upwards. The app is
// sized and positioned to that visible part (one frame at a time, so it
// follows the keyboard animation smoothly instead of jumping), and while a
// field is being typed in the taskbar gets out of the way.

const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isField(el: Element | null): boolean {
  return Boolean(el && (FIELDS.has(el.tagName) || (el as HTMLElement).isContentEditable));
}

export function trackKeyboard(root: HTMLElement = document.documentElement) {
  const vv = window.visualViewport;
  let frame = 0;
  const apply = () => {
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(() => {
      const height = Math.round(vv ? vv.height : window.innerHeight);
      const top = Math.round(vv ? vv.offsetTop : 0);
      root.style.setProperty("--app-h", `${height}px`);
      root.style.setProperty("--app-top", `${top}px`);
      // A big drop in visible height means the keyboard is up.
      root.classList.toggle("keyboard", Boolean(vv) && window.innerHeight - height > 120);
    });
  };
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  document.addEventListener("focusin", (e) => {
    if (isField(e.target as Element)) {
      root.classList.add("kb-typing");
      apply();
    }
  });
  document.addEventListener("focusout", () => {
    // Give the focus a moment to land on the next field before deciding.
    window.setTimeout(() => {
      if (!isField(document.activeElement)) {
        root.classList.remove("kb-typing");
        apply();
      }
    }, 80);
  });
  apply();
}
