import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SnakePage from "./games/snake/SnakePage";
import BigPacTinyManPage from "./games/big-pac-tiny-man/BigPacTinyManPage";
import BigPipeTinyDreamPage from "./games/big-pipe-tiny-dream/BigPipeTinyDreamPage";
import BigAsterTinyOidsPage from "./games/big-aster-tiny-oids/BigAsterTinyOidsPage";
import BigSpaceTinyInvadersPage from "./games/big-space-tiny-invaders/BigSpaceTinyInvadersPage";
import BigRoboTinyTronPage from "./games/big-robo-tiny-tron/BigRoboTinyTronPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/snake" element={<SnakePage />} />
      <Route path="/big-pac-tiny-man" element={<BigPacTinyManPage />} />
      <Route path="/big-pipe-tiny-dream" element={<BigPipeTinyDreamPage />} />
      <Route path="/big-aster-tiny-oids" element={<BigAsterTinyOidsPage />} />
      <Route path="/big-space-tiny-invaders" element={<BigSpaceTinyInvadersPage />} />
      <Route path="/big-robo-tiny-tron" element={<BigRoboTinyTronPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
