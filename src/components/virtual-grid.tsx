import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 윈도우 스크롤 기반의 가벼운 가상 스크롤 그리드.
 * 화면에 보이는 행(+오버스캔)만 렌더링해서 카드 수가 많아도 렌더링 비용이 일정하다.
 */
export function VirtualGrid<T>({
  items,
  getKey,
  renderItem,
  columnsForWidth,
  estimateRowHeight,
  gap = 16,
  overscanRows = 2,
  className,
}: {
  items: T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => React.ReactNode;
  /** 컨테이너 너비(px) → 열 개수 */
  columnsForWidth: (width: number) => number;
  /** 열 너비(px) → 예상 행 높이(px) */
  estimateRowHeight: (columnWidth: number) => number;
  gap?: number;
  overscanRows?: number;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [containerTop, setContainerTop] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [measuredRowH, setMeasuredRowH] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setWidth(rect.width);
    setContainerTop(rect.top + window.scrollY);
    setViewportH(window.innerHeight);
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setScrollY(window.scrollY);
      });
    };
    const onResize = () => measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [measure]);

  const columns = Math.max(1, width ? columnsForWidth(width) : 1);
  const columnWidth = width ? (width - gap * (columns - 1)) / columns : 0;
  const rowHeight =
    measuredRowH || (columnWidth ? estimateRowHeight(columnWidth) : 320);
  const rowCount = Math.ceil(items.length / columns);

  // 첫 렌더 행의 실제 높이를 측정해 추정치를 보정한다.
  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (h > 0 && Math.abs(h - measuredRowH) > 1) setMeasuredRowH(h);
  }, [columns, width, items.length, measuredRowH]);

  const step = rowHeight + gap;
  const relativeTop = scrollY - containerTop;
  const first = Math.max(0, Math.floor(relativeTop / step) - overscanRows);
  const visibleRows = Math.ceil((viewportH || 800) / step) + overscanRows * 2 + 1;
  const last = Math.min(rowCount, first + visibleRows);

  const rows: { index: number; items: T[] }[] = [];
  for (let r = first; r < last; r++) {
    rows.push({ index: r, items: items.slice(r * columns, r * columns + columns) });
  }

  const totalHeight = rowCount > 0 ? rowCount * rowHeight + (rowCount - 1) * gap : 0;
  const offsetTop = first * step;

  return (
    <div ref={containerRef} className={className} style={{ height: totalHeight }}>
      <div style={{ transform: `translateY(${offsetTop}px)` }}>
        {rows.map((row, i) => (
          <div
            key={row.index}
            ref={i === 0 ? rowRef : undefined}
            className={cn("grid")}
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap,
              marginBottom: gap,
            }}
          >
            {row.items.map((item, j) => {
              const index = row.index * columns + j;
              return <div key={getKey(item, index)}>{renderItem(item, index)}</div>;
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
