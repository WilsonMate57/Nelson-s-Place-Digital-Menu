import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../components/Toasts";
import { GuestApp } from "./GuestApp";
import "./guest.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <GuestApp />
    </ToastProvider>
  </StrictMode>,
);
