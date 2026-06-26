/**
 * Landing-page starfield. A lightweight constellation of drifting nodes that
 * link up when they pass close together — a quiet nod to the topology engine
 * inside the lab. Plain canvas, no framework, and disabled automatically when
 * the visitor prefers reduced motion.
 */

interface Star {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

function start(): void {
  const canvas = document.getElementById("starfield");
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const cv: HTMLCanvasElement = canvas;
  const ctx: CanvasRenderingContext2D = context;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stars: Star[] = [];
  let width = 0;
  let height = 0;

  function resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = cv.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    cv.width = Math.floor(width * dpr);
    cv.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const target = Math.min(110, Math.floor((width * height) / 14000));
    stars.length = 0;
    for (let i = 0; i < target; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.4,
      });
    }
  }

  function draw(): void {
    ctx.clearRect(0, 0, width, height);

    for (const s of stars) {
      if (!reduceMotion) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0 || s.x > width) s.vx *= -1;
        if (s.y < 0 || s.y > height) s.vy *= -1;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(170, 178, 197, 0.7)";
      ctx.fill();
    }

    for (let i = 0; i < stars.length; i++) {
      const a = stars[i] as Star;
      for (let j = i + 1; j < stars.length; j++) {
        const b = stars[j] as Star;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist2 = dx * dx + dy * dy;
        const max = 120;
        if (dist2 < max * max) {
          const alpha = (1 - Math.sqrt(dist2) / max) * 0.35;
          ctx.strokeStyle = `rgba(91, 140, 255, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    if (!reduceMotion) requestAnimationFrame(draw);
  }

  resize();
  window.addEventListener("resize", resize);
  draw();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
