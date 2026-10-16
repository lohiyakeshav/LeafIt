import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BlocksPage from './pages/BlocksPage.jsx';
import SimulatorPage from './pages/SimulatorPage.jsx';
import SummaryPage from './pages/SummaryPage.jsx';
import VendorsPage from './pages/VendorsPage.jsx';
import PhotoAuditPage from './pages/PhotoAuditPage.jsx';
import AssumptionsPage from './pages/AssumptionsPage.jsx';
import { ToastProvider } from './components/UI.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100dvh', background: 'var(--page)', color: 'var(--ink)' }}>
        <Routes>
          <Route path="/" element={<BlocksPage />} />
          <Route path="/simulator/:id" element={<SimulatorPage />} />
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/vendors" element={<VendorsPage />} />
          <Route path="/photo-audit" element={<PhotoAuditPage />} />
          <Route path="/assumptions" element={<AssumptionsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <ToastProvider />
      </div>
    </BrowserRouter>
  );
}
