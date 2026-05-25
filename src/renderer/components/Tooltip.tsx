import type { ReactNode } from "react";

interface TooltipProps {
  text: string;
  children: ReactNode;
  /** "right" places the bubble to the right — useful inside the narrow sidebar */
  dir?: "top" | "right" | "bottom";
  /** Render the wrapper as block instead of inline-flex */
  block?: boolean;
}

export function Tooltip({
  text,
  children,
  dir = "top",
  block = false,
}: TooltipProps) {
  return (
    <span
      className={`tip-wrap tip-${dir}${block ? " tip-block" : ""}`}
      data-tip={text}
    >
      {children}
    </span>
  );
}
