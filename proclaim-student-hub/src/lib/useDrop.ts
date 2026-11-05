import { useEffect, useRef, useState } from "react";

// Drag and drop: a photo, screenshot, text file or bit of text dropped on the
// app (iPad Split View, a laptop) is handed over for Add anything. Drops into a
// text box, drags that start inside the app and drops while a sheet is open are
// left to the browser. Returns true while something is being dragged over.

export function useDropToAdd(
  toast: (message: string) => void,
  onDrop: (start: { files: File[]; text: string }) => void,
): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    let depth = 0;
    let inside = false;
    const outsideDrag = (e: DragEvent) =>
      !inside &&
      !document.querySelector("[role='dialog'], .tour") &&
      [...(e.dataTransfer?.types ?? [])].some(
        (t) => t === "Files" || t === "text/plain" || t === "text/uri-list",
      );
    const toField = (e: DragEvent) =>
      e.target instanceof Element && e.target.closest("input, textarea, [contenteditable='true']");
    const start = () => {
      inside = true;
    };
    const end = () => {
      inside = false;
    };
    const enter = (e: DragEvent) => {
      if (outsideDrag(e)) {
        depth++;
        setDragging(true);
      }
    };
    const leave = (e: DragEvent) => {
      if (outsideDrag(e)) {
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
          setDragging(false);
        }
      }
    };
    const over = (e: DragEvent) => {
      if (outsideDrag(e) && !toField(e)) {
        // Without this the browser opens the file instead of handing it over.
        e.preventDefault();
      }
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!outsideDrag(e) || toField(e)) {
        return;
      }
      e.preventDefault();
      const files = [...(e.dataTransfer?.files ?? [])];
      const images = files.filter((f) => f.type.startsWith("image/"));
      const textFiles = files.filter((f) => f.type.startsWith("text/"));
      const plain =
        e.dataTransfer?.getData("text/plain") || e.dataTransfer?.getData("text/uri-list") || "";
      void Promise.all(textFiles.slice(0, 3).map((f) => f.text().catch(() => ""))).then((texts) => {
        const text = [plain, ...texts]
          .map((t) => t.trim())
          .filter(Boolean)
          .join("\n\n")
          .slice(0, 8000);
        if (images.length === 0 && !text) {
          toast(
            files.some((f) => f.type === "application/pdf")
              ? "PDFs can't be read yet. Drop a screenshot of the page instead."
              : "That can't be added. Drop a photo, screenshot or some text.",
          );
          return;
        }
        latest.current({ files: images, text });
      });
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [toast]);
  return dragging;
}
