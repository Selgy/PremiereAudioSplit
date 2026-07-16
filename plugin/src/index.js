import React from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@swc-react/theme";
import App from "./App.jsx";
import "./App.css";

window.React = React;

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <Theme theme="spectrum" scale="medium" color="dark">
    <App />
  </Theme>
);
