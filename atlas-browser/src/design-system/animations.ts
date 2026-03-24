/**
 * Atlas Browser Design System - Framer Motion Animation Variants
 *
 * Reusable animation presets for consistent motion across the UI.
 */

import type { Variants, Transition } from "framer-motion";

// ── Spring Configs ──

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
};

export const springFluid: Transition = {
  type: "spring",
  stiffness: 150,
  damping: 20,
};

// ── Core Variants ──

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.3, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.2, ease: "easeIn" } },
};

export const slideInRight: Variants = {
  initial: { opacity: 0, x: 16 },
  animate: {
    opacity: 1,
    x: 0,
    transition: springSnappy,
  },
  exit: {
    opacity: 0,
    x: 16,
    transition: { duration: 0.2, ease: "easeIn" },
  },
};

export const slideInUp: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: {
    opacity: 1,
    y: 0,
    transition: springSnappy,
  },
  exit: {
    opacity: 0,
    y: 12,
    transition: { duration: 0.2, ease: "easeIn" },
  },
};

export const scaleIn: Variants = {
  initial: { opacity: 0, scale: 0.92 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: springSnappy,
  },
  exit: {
    opacity: 0,
    scale: 0.92,
    transition: { duration: 0.15, ease: "easeIn" },
  },
};

export const staggerChildren: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.03,
      staggerDirection: -1,
    },
  },
};

// ── Tab Animations ──

export const tabContent: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: springFluid,
  },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.15, ease: "easeIn" },
  },
};

export const tabIndicator: Variants = {
  initial: { scaleX: 0 },
  animate: {
    scaleX: 1,
    transition: springSnappy,
  },
  exit: {
    scaleX: 0,
    transition: { duration: 0.15, ease: "easeIn" },
  },
};

export const tabHover = {
  scale: 1.02,
  transition: springSnappy,
};

// ── Panel Animations ──

export const panelSlideIn: Variants = {
  initial: { opacity: 0, x: "100%" },
  animate: {
    opacity: 1,
    x: 0,
    transition: springFluid,
  },
  exit: {
    opacity: 0,
    x: "100%",
    transition: { duration: 0.25, ease: "easeIn" },
  },
};

export const panelExpand: Variants = {
  initial: { opacity: 0, height: 0, overflow: "hidden" },
  animate: {
    opacity: 1,
    height: "auto",
    overflow: "visible",
    transition: {
      height: springFluid,
      opacity: { duration: 0.25, ease: "easeOut", delay: 0.05 },
    },
  },
  exit: {
    opacity: 0,
    height: 0,
    overflow: "hidden",
    transition: {
      height: { duration: 0.2, ease: "easeIn" },
      opacity: { duration: 0.12, ease: "easeIn" },
    },
  },
};

export const panelFade: Variants = {
  initial: { opacity: 0, scale: 0.98 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: springSnappy,
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: 0.15, ease: "easeIn" },
  },
};

// ── Context Menu Animations ──

export const contextMenu: Variants = {
  initial: { opacity: 0, scale: 0.9, y: -4 },
  animate: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 28,
      mass: 0.8,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: -2,
    transition: { duration: 0.12, ease: "easeIn" },
  },
};

export const contextMenuItem: Variants = {
  initial: { opacity: 0, x: -8 },
  animate: {
    opacity: 1,
    x: 0,
    transition: springSnappy,
  },
  exit: {
    opacity: 0,
    x: -4,
    transition: { duration: 0.1, ease: "easeIn" },
  },
};

export const contextMenuStagger: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1,
    },
  },
};
