import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SnakePage from "./games/snake/SnakePage";
import BigPacTinyManPage from "./games/big-pac-tiny-man/BigPacTinyManPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/snake" element={<SnakePage />} />
      <Route path="/big-pac-tiny-man" element={<BigPacTinyManPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
