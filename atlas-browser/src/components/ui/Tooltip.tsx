import { type ReactNode, useState, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";

type Position = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: Position;
}

const positionStyles: Record<Position, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

export function Tooltip({
  content,
  children,
  position = "top",
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 500);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  return (
    <div className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className={[
              "absolute z-50 pointer-events-none",
              "whitespace-nowrap px-3 py-1.5",
              "bg-[var(--atlas-void)] border border-[var(--atlas-steel)]",
              "rounded-[var(--atlas-radius-sm)]",
              "text-[var(--atlas-text-sm)] text-[var(--atlas-text-primary)]",
              "shadow-[var(--atlas-shadow-md)]",
              positionStyles[position],
            ].join(" ")}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
