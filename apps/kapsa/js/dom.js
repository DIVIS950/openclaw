// Small DOM helpers: element builder, toasts, haptics.

/**
 * Build an element. Children can be nodes, strings or arrays; strings become text
 * nodes, so user data is never parsed as HTML. Use `html` only for trusted markup (icons).
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      el.className = value;
    } else if (key === "html") {
      el.innerHTML = value;
    } else if (key === "style" && typeof value === "object") {
      for (const [prop, v] of Object.entries(value)) {
        el.style.setProperty(prop, String(v));
      }
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "dataset") {
      Object.assign(el.dataset, value);
    } else if (value === true) {
      el.setAttribute(key, "");
    } else {
      el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    if (Array.isArray(child)) {
      append(el, child);
    } else if (child instanceof Node) {
      el.append(child);
    } else {
      el.append(document.createTextNode(String(child)));
    }
  }
}

/** Replace all children of a node. */
export function mount(parent, ...children) {
  parent.replaceChildren();
  append(parent, children);
}

let toastTimer = 0;

/**
 * Short message at the bottom of the screen, optionally with one action button.
 * @param {string} message
 * @param {{ action?: string, onAction?: () => void, ms?: number }} [opts]
 */
export function toast(message, opts = {}) {
  const host = document.getElementById("toast");
  if (!host) {
    return;
  }
  clearTimeout(toastTimer);
  const children = [h("span", null, message)];
  if (opts.action && opts.onAction) {
    children.push(
      h(
        "button",
        {
          type: "button",
          class: "toast-action",
          onclick: () => {
            host.hidden = true;
            opts.onAction?.();
          },
        },
        opts.action,
      ),
    );
  }
  mount(host, ...children);
  host.hidden = false;
  host.classList.remove("toast-in");
  // Restart the entrance animation.
  void host.offsetWidth;
  host.classList.add("toast-in");
  toastTimer = window.setTimeout(() => {
    host.hidden = true;
  }, opts.ms ?? 2600);
}

/** Light vibration where supported (Android). */
export function buzz(pattern = 18) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Ignore: vibration is a nice-to-have.
  }
}

/**
 * Copy text, falling back to a hidden textarea for older browsers.
 * @param {string} text
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
