import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import GalleryPage from "./pages/GalleryPage";
import FeedbackAdminPage from "./pages/FeedbackAdminPage";
import SingadoodlePage from "./minis/singadoodle/SingadoodlePage";

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
      {/* Pure AI Output — Singadoodle, a microphone pitch-matching trainer. */}
      <Route path="/singadoodle" element={<SingadoodlePage />} />
      {/* Singadoodle used to be called Pitchcraft — keep old links working. */}
      <Route path="/pitchcraft" element={<Navigate to="/singadoodle" replace />} />
      {/* Secret, password-gated feedback console. */}
      <Route path="/manage/feedback" element={<FeedbackAdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
