import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import GalleryPage from './pages/GalleryPage';

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
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
