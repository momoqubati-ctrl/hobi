import React from "react";
import { createRoot } from "react-dom/client";
import { ProfileModalHarness } from "./ProfileModalHarness";
import "@/globals.css";

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <ProfileModalHarness />
    </React.StrictMode>
  );
}
