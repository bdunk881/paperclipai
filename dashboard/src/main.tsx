import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import App from "./App";
import { initializeMsalInstance } from "./auth/msalInstance";
import "./index.css";
import { initializeTheme } from "./hooks/useTheme";

initializeTheme();

async function bootstrap() {
  await initializeMsalInstance();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
