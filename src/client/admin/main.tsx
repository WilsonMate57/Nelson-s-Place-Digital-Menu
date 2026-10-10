import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastProvider } from "../components/Toasts";
import { AdminApp } from "./AdminApp";
import "./admin.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <AdminApp />
    </ToastProvider>
  </StrictMode>,
);
