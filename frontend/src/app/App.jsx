import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import HomePage from '../features/home/HomePage.jsx';
import { AssumptionsPage, ExplorePage, StudioPage, SummaryPage, VendorsPage } from './lazyPages.js';
import { Spinner, ToastProvider } from '../shared/UI.jsx';

const Loading = () => <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>;
const OldSimulatorLink = () => <Navigate to={`/block/${useParams().id}`} replace />;

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: '100dvh', background: 'var(--page)', color: 'var(--ink)' }}>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/explore" element={<ExplorePage />} />
            <Route path="/area/:id" element={<StudioPage />} />
            <Route path="/block/:id" element={<StudioPage />} />
            <Route path="/simulator/:id" element={<OldSimulatorLink />} />
            <Route path="/summary" element={<SummaryPage />} />
            <Route path="/vendors" element={<VendorsPage />} />
            <Route path="/assumptions" element={<AssumptionsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <ToastProvider />
      </div>
    </BrowserRouter>
  );
}
