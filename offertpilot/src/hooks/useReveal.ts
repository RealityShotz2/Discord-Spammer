import { useEffect, useRef } from "react";

/** Lättvikts scroll-reveal: element med klassen .reveal tonas in och glider upp 20px, med stagger via --d. */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}
