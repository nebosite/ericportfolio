import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import GalleryPage from "./pages/GalleryPage";
import FeedbackAdminPage from "./pages/FeedbackAdminPage";
import McpPage from "./pages/McpPage";
import SingadoodlePage from "./minis/singadoodle/SingadoodlePage";
import ThreeAheadPage from "./minis/threeahead/ThreeAheadPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/art" element={<GalleryPage folder="Art" heading="Art" />} />
      <Route
        path="/photography"
        element={<GalleryPage folder="Photography" heading="Photography" />}
      />
      <Route path="/writing" element={<GalleryPage folder="writing" heading="Writing" />} />
      {/* MCP highlight page (linked from the AI-Enhanced list). Note: /mcp and
          /coach are nginx-routed to the live MCP services, so the SPA route uses
          the full name to avoid the collision. */}
      <Route path="/model-context-protocol" element={<McpPage />} />
      {/* Pure AI Output — Singadoodle, a microphone pitch-matching trainer. */}
      <Route path="/singadoodle" element={<SingadoodlePage />} />
      {/* Singadoodle used to be called Pitchcraft — keep old links working. */}
      <Route path="/pitchcraft" element={<Navigate to="/singadoodle" replace />} />
      {/* Pure AI Output — Three Ahead Chess, chess planned three sealed moves at a time. */}
      <Route path="/three-ahead-chess" element={<ThreeAheadPage />} />
      {/* Secret, password-gated feedback console. */}
      <Route path="/manage/feedback" element={<FeedbackAdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
