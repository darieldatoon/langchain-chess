// Stands in for LangSmith: one render.html frame per sample, each sent its message the way
// LangSmith's IFrameTraceRenderer does, repeated while the page loads.
import { failed, inputs, jev, reference, semif } from "./samples";

const FRAMES = [
  { title: "Reference: Stockfish", type: "reference", data: reference },
  { title: "Output: SemIf (tournament)", type: "output", data: semif },
  { title: "Output: Jev", type: "output", data: jev },
  { title: "Output: a failed ranking", type: "output", data: failed },
] as const;

const grid = document.getElementById("frames")!;
for (const { title, type, data } of FRAMES) {
  const figure = document.createElement("figure");
  const caption = document.createElement("figcaption");
  caption.textContent = title;
  const frame = document.createElement("iframe");
  frame.src = "./render.html";
  frame.title = title;
  frame.sandbox.add("allow-scripts", "allow-same-origin");
  frame.addEventListener("load", () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      setTimeout(
        () => frame.contentWindow?.postMessage({ type, data, metadata: { inputs } }, "*"),
        100 * (2 ** attempt - 1),
      );
    }
  });
  figure.append(caption, frame);
  grid.append(figure);
}
