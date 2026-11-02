// Swipe a sheet down by its top bar to close it, like native phone sheets.

/**
 * @param {HTMLDialogElement} dialog
 * @param {() => void} onClose called once the sheet should close
 */
export function enableSwipeToClose(dialog, onClose) {
  let startY = 0;
  let startT = 0;
  let dy = 0;
  let dragging = false;

  const reset = () => {
    dialog.style.transition = "";
    dialog.style.transform = "";
  };

  dialog.addEventListener("pointerdown", (e) => {
    if (!dialog.open || dialog.classList.contains("sheet-dark") || e.button > 0) {
      return;
    }
    // Only from the handle and title bar at the top, and never from a control.
    const fromTop = e.clientY - dialog.getBoundingClientRect().top;
    if (fromTop > 76 || /** @type {HTMLElement} */ (e.target).closest("button, input, textarea, select, a, label")) {
      return;
    }
    dragging = true;
    startY = e.clientY;
    startT = performance.now();
    dy = 0;
    dialog.setPointerCapture(e.pointerId);
  });

  dialog.addEventListener("pointermove", (e) => {
    if (!dragging) {
      return;
    }
    dy = Math.max(0, e.clientY - startY);
    dialog.style.transition = "none";
    dialog.style.transform = `translateY(${dy}px)`;
  });

  const end = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    const speed = dy / Math.max(1, performance.now() - startT);
    if (dy > 110 || (speed > 0.6 && dy > 30)) {
      dialog.style.transition = "transform 0.2s ease-in";
      dialog.style.transform = "translateY(100%)";
      window.setTimeout(onClose, 160);
    } else {
      dialog.style.transition = "transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)";
      dialog.style.transform = "";
    }
  };
  dialog.addEventListener("pointerup", end);
  dialog.addEventListener("pointercancel", end);
  // Clear the drag offset once the sheet has closed, so the next one opens normally.
  dialog.addEventListener("close", reset);
}
