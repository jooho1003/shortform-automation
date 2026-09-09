'use client';

export function PrintButton() {
  return (
    <button type="button" className="btn primary" onClick={() => window.print()}>
      PDF로 저장 (인쇄)
    </button>
  );
}
