import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import { installNavContainment } from "./lib/containNav";

export default function App() {
  // Trap the browser's back/forward (and the mouse side buttons) so a random
  // tap can never navigate the child out of PixelWhimsy.
  useEffect(() => installNavContainment(), []);

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
