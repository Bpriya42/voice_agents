import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// Placeholder for M1. M4 replaces this with the real shell.
createRoot(root).render(
  <StrictMode>
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Ava</h1>
    </main>
  </StrictMode>,
);
