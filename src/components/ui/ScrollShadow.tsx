import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Wrapper que adiciona shadows às bordas de um container com scroll horizontal
 * para indicar que há mais conteúdo, principalmente útil em tabelas em mobile.
 *
 * Comportamento:
 *   - Shadow esquerda aparece quando scrollLeft > 0
 *   - Shadow direita aparece quando scrollLeft < scrollWidth - clientWidth
 *   - Ambas somem quando o container está totalmente visível
 *
 * @example
 *   <ScrollShadow>
 *     <table className="table">...</table>
 *   </ScrollShadow>
 */
interface ScrollShadowProps {
  children: ReactNode;
  className?: string;
}

export function ScrollShadow({ children, className = '' }: ScrollShadowProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      if (!el) return;
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setShowLeft(scrollLeft > 2);
      setShowRight(scrollLeft < scrollWidth - clientWidth - 2);
    }

    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        className="overflow-x-auto"
        style={{ scrollbarWidth: 'thin' }}
      >
        {children}
      </div>
      {/* Left shadow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-slate-200/80 to-transparent transition-opacity dark:from-border-dark/80 ${
          showLeft ? 'opacity-100' : 'opacity-0'
        }`}
      />
      {/* Right shadow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-slate-200/80 to-transparent transition-opacity dark:from-border-dark/80 ${
          showRight ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
