// A short confetti burst on a full-screen canvas, for rewards and new cards.

const COLORS = ["#2F5BFF", "#FF4F9A", "#FF8A1F", "#C6F432", "#7A5CFF", "#FFD23F", "#12C77A"];

/**
 * @param {{ x?: number, y?: number, count?: number }} [opts] origin in viewport fractions
 */
export function confetti(opts = {}) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const ox = (opts.x ?? 0.5) * innerWidth;
  const oy = (opts.y ?? 0.4) * innerHeight;
  const parts = Array.from({ length: opts.count ?? 90 }, (_, i) => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
    const speed = 7 + Math.random() * 9;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      c: COLORS[i % COLORS.length],
    };
  });
  const start = performance.now();
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 1800);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < 1800) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(frame);
}
