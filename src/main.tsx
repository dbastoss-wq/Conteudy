import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SabiaApp } from "@/components/sabia/app/SabiaApp";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SabiaApp />
  </StrictMode>,
);
