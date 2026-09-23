'use client';
import {useEffect, useRef, type ReactNode} from 'react';

export function StudioModal({children, onClose}: {children: ReactNode; onClose: () => void}) {
  const container = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {close.current = onClose;}, [onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(el => el.getClientRects().length);
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {event.preventDefault(); close.current();}
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {event.preventDefault(); return;}
      const first = items[0], last = items[items.length-1];
      if (event.shiftKey && (document.activeElement === first || !container.current?.contains(document.activeElement))) {event.preventDefault(); last.focus();}
      else if (!event.shiftKey && (document.activeElement === last || !container.current?.contains(document.activeElement))) {event.preventDefault(); first.focus();}
    };
    document.addEventListener('keydown', keydown);
    return () => {document.removeEventListener('keydown', keydown); previous?.focus();};
  }, []);
  return <div ref={container} className="studio-modal-backdrop">{children}</div>;
}
