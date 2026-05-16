import { useRef, useState, useEffect } from 'react';

export function usePinchZoom() {
  const containerRef = useRef(null);
  const s = useRef({ scale: 1, x: 0, y: 0, startTouches: null, startScale: 1, startX: 0, startY: 0 });
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid  = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    function onTouchStart(e) {
      s.current.startTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }));
      s.current.startScale = s.current.scale;
      s.current.startX = s.current.x;
      s.current.startY = s.current.y;
    }

    function onTouchMove(e) {
      const { startTouches, startScale, startX, startY } = s.current;
      if (!startTouches) return;
      const rect = el.getBoundingClientRect();

      if (e.touches.length === 2 && startTouches.length === 2) {
        e.preventDefault();
        const [t0, t1] = [e.touches[0], e.touches[1]];
        const [st0, st1] = [startTouches[0], startTouches[1]];

        const newScale = clamp(startScale * (dist(t0, t1) / dist(st0, st1)), 1, 4);
        const sm = mid(st0, st1);
        const cm = mid(t0, t1);

        // Origin of zoom relative to container center
        const ox = sm.x - rect.left - rect.width / 2;
        const oy = sm.y - rect.top - rect.height / 2;
        const sf = newScale / startScale;

        const newX = clamp(startX * sf + (cm.x - sm.x) + ox * (1 - sf), -rect.width * (newScale - 1) / 2, rect.width * (newScale - 1) / 2);
        const newY = clamp(startY * sf + (cm.y - sm.y) + oy * (1 - sf), -rect.height * (newScale - 1) / 2, rect.height * (newScale - 1) / 2);

        s.current.scale = newScale;
        s.current.x = newX;
        s.current.y = newY;
        setTransform({ scale: newScale, x: newX, y: newY });

      } else if (e.touches.length === 1 && startScale > 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - startTouches[0].clientX;
        const dy = e.touches[0].clientY - startTouches[0].clientY;
        const newX = clamp(startX + dx, -rect.width * (startScale - 1) / 2, rect.width * (startScale - 1) / 2);
        const newY = clamp(startY + dy, -rect.height * (startScale - 1) / 2, rect.height * (startScale - 1) / 2);
        s.current.x = newX;
        s.current.y = newY;
        setTransform({ scale: startScale, x: newX, y: newY });
      }
    }

    function onTouchEnd(e) {
      // Update start state for any continuing gesture with remaining fingers
      s.current.startTouches = Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY }));
      s.current.startScale = s.current.scale;
      s.current.startX = s.current.x;
      s.current.startY = s.current.y;
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  return { containerRef, transform };
}
