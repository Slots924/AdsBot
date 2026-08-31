import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./styles/keitaro-gray.css";
import "./styles/app.css";

const root = createRoot(document.getElementById("root"));

if (new URLSearchParams(window.location.search).has("gray-ui")) {
    import("./design/KeitaroGrayShowcase.jsx").then(({ default: KeitaroGrayShowcase }) => root.render(<KeitaroGrayShowcase />));
} else {
    root.render(<App />);
}
