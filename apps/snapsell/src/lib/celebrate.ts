const COLORS = ["#ff5b24", "#17150f", "#ffc3a9", "#1e6b45", "#7bd88f", "#f3efe6", "#c2410c"];

/** A short burst of confetti from the top of the screen (Web Animations, no library). */
export function celebrate(count = 90) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden";
  document.body.append(layer);
  const w = innerWidth;
  const h = innerHeight;
  let left = count;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    const size = 6 + Math.random() * 7;
    const round = Math.random() < 0.35;
    p.style.cssText = `position:absolute;left:${w / 2}px;top:${h * 0.28}px;width:${size}px;height:${round ? size : size * 0.45}px;background:${COLORS[i % COLORS.length]};border-radius:${round ? "50%" : "2px"}`;
    layer.append(p);
    const angle = Math.random() * Math.PI * 2;
    const power = 120 + Math.random() * 260;
    const dx = Math.cos(angle) * power;
    const dy = Math.sin(angle) * power - 160;
    const spin = (Math.random() - 0.5) * 1440;
    const anim = p.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px,${dy}px) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx * 1.3}px,${dy + h * 0.75}px) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 1600 + Math.random() * 900, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" },
    );
    anim.onfinish = () => {
      p.remove();
      if (--left === 0) layer.remove();
    };
  }
}
