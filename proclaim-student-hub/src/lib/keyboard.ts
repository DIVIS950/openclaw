// The phone keyboard: when it opens, iOS and Android shrink the visible part
// of the page but not the page itself, so the taskbar and composer end up
// hidden behind the keyboard and the layout jumps. This keeps the app the
// size of what's actually visible, pins it to the top, and hides the taskbar
// while a field is being typed in.

const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isField(el: Element | null): boolean {
  return Boolean(el && (FIELDS.has(el.tagName) || (el as HTMLElement).isContentEditable));
}

export function trackKeyboard(root: HTMLElement = document.documentElement) {
  const vv = window.visualViewport;
  const apply = () => {
    const height = Math.round(vv ? vv.height : window.innerHeight);
    root.style.setProperty("--app-h", `${height}px`);
    // A big drop in visible height means the keyboard is up.
    root.classList.toggle("keyboard", Boolean(vv) && window.innerHeight - height > 120);
    // iOS scrolls the whole page to show the field; scroll it back so the app stays put.
    if (vv && (vv.offsetTop > 0 || window.scrollY > 0)) {
      window.scrollTo(0, 0);
    }
  };
  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  document.addEventListener("focusin", (e) => {
    if (isField(e.target as Element)) {
      root.classList.add("typing");
    }
  });
  document.addEventListener("focusout", () => {
    // Give the focus a moment to land on the next field before deciding.
    window.setTimeout(() => {
      if (!isField(document.activeElement)) {
        root.classList.remove("typing");
      }
    }, 80);
  });
  apply();
}
