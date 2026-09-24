"use client";

import { useRef, useState } from "react";

// Drag gesture for the Discovery Hub's mobile list sheet.
//
// Two grab points share one hook:
//   "open"  — the peek bar over the map: drag up (or tap) opens the list
//   "close" — the handle on the open sheet: drag down closes it
// While a finger is down, `drag` holds the live offset so the sheet can
// follow it with transitions off; on release it either commits (far or
// fast enough) or springs back.

type Mode = "open" | "close";

const MOVE_THRESHOLD = 6; // px before a press counts as a drag, not a tap
const COMMIT_DISTANCE = 100; // px
const COMMIT_VELOCITY = 0.5; // px per ms — a quick flick commits early

export function useSheetDrag({
  onOpen,
  onClose,
}: {
  onOpen: () => void;
  onClose: () => void;
}) {
  const [drag, setDrag] = useState<{ mode: Mode; dy: number } | null>(null);
  const start = useRef<{ y: number; t: number; mode: Mode; moved: boolean } | null>(null);

  function bind(mode: Mode) {
    return {
      onPointerDown(e: React.PointerEvent<HTMLElement>) {
        start.current = { y: e.clientY, t: e.timeStamp, mode, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      },
      onPointerMove(e: React.PointerEvent<HTMLElement>) {
        const s = start.current;
        if (!s) return;
        const dy = e.clientY - s.y;
        if (!s.moved && Math.abs(dy) < MOVE_THRESHOLD) return;
        s.moved = true;
        setDrag({ mode, dy });
      },
      onPointerUp(e: React.PointerEvent<HTMLElement>) {
        const s = start.current;
        start.current = null;
        setDrag(null);
        if (!s) return;
        if (!s.moved) {
          if (s.mode === "open") onOpen(); // a tap on the peek bar opens
          return;
        }
        const dy = e.clientY - s.y;
        const velocity = dy / Math.max(e.timeStamp - s.t, 1);
        if (s.mode === "close" && (dy > COMMIT_DISTANCE || velocity > COMMIT_VELOCITY)) onClose();
        if (s.mode === "open" && (dy < -COMMIT_DISTANCE || velocity < -COMMIT_VELOCITY)) onOpen();
      },
      onPointerCancel() {
        start.current = null;
        setDrag(null);
      },
    };
  }

  return { drag, bind };
}

// Sheet translateY for a given state. Pulling against the allowed
// direction is damped (rubber band) instead of blocked outright.
export function sheetOffset(open: boolean, drag: { mode: Mode; dy: number } | null): string {
  if (drag?.mode === "close") {
    const dy = drag.dy > 0 ? drag.dy : drag.dy * 0.2;
    return `${dy}px`;
  }
  if (drag?.mode === "open") {
    const dy = drag.dy < 0 ? drag.dy : drag.dy * 0.2;
    return `calc(100% + ${dy}px)`;
  }
  return open ? "0px" : "100%";
}
