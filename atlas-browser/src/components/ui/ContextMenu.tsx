import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onClick?: () => void;
  /** Render a separator line instead of a clickable item */
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose?: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  /* Close on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose?.();
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <motion.div
      ref={menuRef}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={[
        "fixed z-[100] min-w-[180px]",
        "bg-[var(--atlas-navy)] border border-[var(--atlas-steel)]",
        "rounded-[var(--atlas-radius-md)]",
        "shadow-[var(--atlas-shadow-xl)]",
        "backdrop-blur-[var(--atlas-glass-blur)]",
        "py-1 overflow-hidden",
      ].join(" ")}
      style={{ top: position.y, left: position.x }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div
            key={i}
            className="my-1 border-t border-[var(--atlas-steel)]"
          />
        ) : (
          <button
            key={i}
            onClick={() => {
              item.onClick?.();
              onClose?.();
            }}
            className={[
              "flex items-center w-full gap-2 px-3 py-1.5",
              "text-[var(--atlas-text-sm)] text-[var(--atlas-text-primary)]",
              "hover:bg-[var(--atlas-slate)] cursor-pointer",
              "transition-colors duration-[var(--atlas-transition-fast)]",
            ].join(" ")}
          >
            {item.icon && (
              <span className="w-4 h-4 flex items-center justify-center text-[var(--atlas-text-tertiary)]">
                {item.icon}
              </span>
            )}
            <span className="flex-1 text-left">{item.label}</span>
            {item.shortcut && (
              <span className="text-[var(--atlas-text-xs)] text-[var(--atlas-text-tertiary)] ml-4">
                {item.shortcut}
              </span>
            )}
          </button>
        ),
      )}
    </motion.div>
  );
}
