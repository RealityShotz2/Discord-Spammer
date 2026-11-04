import { useEffect, useRef } from "react";

/**
 * "Flygvägar": partiklar (förfrågningar) som strömmar längs mjuka kurvor och samlas i en fokuspunkt (offerten).
 * Reagerar på muspekaren, pausar utanför skärmen och respekterar prefers-reduced-motion.
 */
export function HeroCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, t = 0;
    const mouse = { x: -9999, y: -9999, active: false };

    type Lane = { y0: number; c1: number; c2: number; hue: number };
    type P = { lane: number; s: number; speed: number; size: number; jitter: number; ox: number; oy: number };
    let lanes: Lane[] = [];
    let parts: P[] = [];

    const target = () => ({ x: w * (w < 768 ? 0.82 : 0.74), y: h * 0.48 });

    const setup = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = w < 768 ? 9 : 14;
      lanes = Array.from({ length: n }, (_, i) => {
        const f = i / (n - 1);
        return { y0: h * (0.05 + f * 0.9), c1: (Math.random() - 0.5) * h * 0.5, c2: (Math.random() - 0.5) * h * 0.25, hue: 232 + f * 40 };
      });
      const count = Math.round(Math.min(220, (w * h) / 5200));
      parts = Array.from({ length: count }, () => ({
        lane: Math.floor(Math.random() * n), s: Math.random(), speed: 0.0009 + Math.random() * 0.0016,
        size: 0.6 + Math.random() * 1.6, jitter: Math.random() * Math.PI * 2, ox: 0, oy: 0,
      }));
    };

    // Kubisk bezier från vänster kant till fokuspunkten
    const point = (lane: Lane, s: number) => {
      const tg = target();
      const x0 = -40, y0 = lane.y0;
      const x1 = w * 0.3, y1 = lane.y0 + lane.c1;
      const x2 = w * 0.55, y2 = tg.y + lane.c2;
      const u = 1 - s;
      return {
        x: u * u * u * x0 + 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s * tg.x,
        y: u * u * u * y0 + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * tg.y,
      };
    };

    const draw = () => {
      t += 1;
      ctx.clearRect(0, 0, w, h);
      const tg = target();

      // Svaga banor
      ctx.lineWidth = 1;
      for (const lane of lanes) {
        ctx.beginPath();
        for (let s = 0; s <= 1.0001; s += 0.04) {
          const p = point(lane, s);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = `hsla(${lane.hue}, 90%, 72%, 0.07)`;
        ctx.stroke();
      }

      // Glöd i fokuspunkten
      const pulse = 1 + Math.sin(t * 0.03) * 0.08;
      const g = ctx.createRadialGradient(tg.x, tg.y, 0, tg.x, tg.y, 140 * pulse);
      g.addColorStop(0, "rgba(167,139,250,0.45)");
      g.addColorStop(0.35, "rgba(99,102,241,0.16)");
      g.addColorStop(1, "rgba(99,102,241,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(tg.x, tg.y, 140 * pulse, 0, Math.PI * 2); ctx.fill();

      // Partiklar
      for (const p of parts) {
        if (!reduced) p.s += p.speed * (0.6 + p.s);
        if (p.s >= 1) { p.s = 0; p.lane = Math.floor(Math.random() * lanes.length); }
        const base = point(lanes[p.lane], p.s);
        const wob = Math.sin(t * 0.02 + p.jitter) * 3 * (1 - p.s);
        let x = base.x, y = base.y + wob;
        // Muspekaren knuffar partiklarna mjukt åt sidan
        const dx = x - mouse.x, dy = y - mouse.y, d2 = dx * dx + dy * dy;
        if (mouse.active && d2 < 14000) {
          const f = (1 - d2 / 14000) * 26;
          const d = Math.sqrt(d2) || 1;
          p.ox += ((dx / d) * f - p.ox) * 0.15; p.oy += ((dy / d) * f - p.oy) * 0.15;
        } else { p.ox *= 0.92; p.oy *= 0.92; }
        x += p.ox; y += p.oy;
        const alpha = Math.min(1, p.s * 4) * (1 - Math.max(0, p.s - 0.9) * 10);
        ctx.fillStyle = `hsla(${lanes[p.lane].hue}, 95%, ${70 + p.s * 20}%, ${0.85 * alpha})`;
        ctx.beginPath(); ctx.arc(x, y, p.size * (1 - p.s * 0.4), 0, Math.PI * 2); ctx.fill();
      }

      // Kärna
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath(); ctx.arc(tg.x, tg.y, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(196,181,253,0.5)";
      ctx.beginPath(); ctx.arc(tg.x, tg.y, 14 + Math.sin(t * 0.05) * 2, 0, Math.PI * 2); ctx.stroke();

      if (visible && !reduced) raf = requestAnimationFrame(draw);
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.active = true;
    };
    const onLeave = () => { mouse.active = false; };
    const io = new IntersectionObserver(([e]) => {
      const was = visible;
      visible = e.isIntersecting && !document.hidden;
      if (visible && !was && !reduced) raf = requestAnimationFrame(draw);
    });
    const onVis = () => {
      const was = visible;
      visible = !document.hidden;
      if (visible && !was && !reduced) raf = requestAnimationFrame(draw);
    };
    const ro = new ResizeObserver(() => { setup(); if (reduced) draw(); });

    setup();
    draw();
    io.observe(canvas);
    ro.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    canvas.parentElement?.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      canvas.parentElement?.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
