import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import GalleryPage from './pages/GalleryPage';
import FeedbackAdminPage from './pages/FeedbackAdminPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/art" element={<GalleryPage folder="Art" heading="Art" />} />
      <Route
        path="/photography"
        element={<GalleryPage folder="Photography" heading="Photography" />}
      />
      <Route path="/poetry" element={<GalleryPage folder="Poetry" heading="Poetry" />} />
      {/* Secret, password-gated feedback console. */}
      <Route path="/manage/feedback" element={<FeedbackAdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
