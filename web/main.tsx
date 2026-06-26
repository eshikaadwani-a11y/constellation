/**
 * Browser entry point for the Constellation laboratory.
 *
 * React and the rest of the UI stack are resolved at runtime through the import
 * map declared in `public/app.html`, so there is no bundler in the loop — `tsc`
 * compiles this TSX to standard ES modules that the browser loads directly.
 */
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<App />);
}
