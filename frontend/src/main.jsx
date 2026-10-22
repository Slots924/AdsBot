import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import "./styles/shared-ui.css";
import "./styles/app.css";

const root = createRoot(document.getElementById("root"));

if (new URLSearchParams(window.location.search).has("autoupload-ui") && !window.adsBot) {
    import("./design/AutouploadShowcase.jsx").then(({ default: AutouploadShowcase }) => root.render(<AutouploadShowcase />));
} else if (new URLSearchParams(window.location.search).has("bm-ui") && !window.adsBot) {
    import("./design/BusinessManagerShowcase.jsx").then(({ default: BusinessManagerShowcase }) => root.render(<BusinessManagerShowcase />));
} else {
    root.render(<App />);
}
