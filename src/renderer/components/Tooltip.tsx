import {
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  text: string;
  children: ReactNode;
  /** @deprecated Direction is now auto-calculated from cursor position */
  dir?: "top" | "right" | "bottom";
  /** Render the wrapper as block instead of inline-flex */
  block?: boolean;
}

const MAX_W = 260;
const OFFSET_X = 14;
const OFFSET_Y = 18;

export function Tooltip({ text, children, block = false }: TooltipProps) {
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [bubbleStyle, setBubbleStyle] = useState<React.CSSProperties>({
    opacity: 0,
    left: -9999,
    top: -9999,
  });
  const bubbleRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setMouse({ x: e.clientX, y: e.clientY });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMouse(null);
  }, []);

  useLayoutEffect(() => {
    if (!mouse || !bubbleRef.current) {
      setBubbleStyle({ opacity: 0, left: -9999, top: -9999 });
      return;
    }
    const h = bubbleRef.current.offsetHeight;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    let x = mouse.x + OFFSET_X;
    let y = mouse.y + OFFSET_Y;
    if (x + MAX_W + 8 > winW) x = mouse.x - MAX_W - OFFSET_X;
    if (y + h + 8 > winH) y = mouse.y - h - OFFSET_Y;

    setBubbleStyle({ opacity: 1, left: x, top: y });
  }, [mouse]);

  return (
    <span
      role="none"
      className={`tip-wrap${block ? " tip-block" : ""}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {mouse !== null &&
        createPortal(
          <div ref={bubbleRef} className="tip-bubble" style={bubbleStyle}>
            {text}
          </div>,
          document.body,
        )}
    </span>
  );
}
