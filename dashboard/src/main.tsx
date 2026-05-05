import React from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import App from "./App";
import "./index.css";
import { initializeTheme } from "./hooks/useTheme";
import { initSentry } from "./sentry";

initSentry();
initializeTheme();

function bootstrap() {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
