import { useEffect, useState } from "react";
import type { Viewport } from "./scales";

/** The window's size, settled to the end of a resize (one update per frame at most). */
export function useViewport(): Viewport {
  const [size, setSize] = useState<Viewport>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setSize((current) =>
          current.width === window.innerWidth && current.height === window.innerHeight
            ? current
            : { width: window.innerWidth, height: window.innerHeight },
        );
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return size;
}
