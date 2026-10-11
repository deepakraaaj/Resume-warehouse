import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import './index.css';
import { AppProvider } from './lib/state';
import { Shell } from './components/Shell';
import Today from './pages/Today';
import { Companies, NewCompany } from './pages/Companies';
import { Spinner } from './components/ui';
import { AuthGate } from './pages/Auth';
import { OverlayProvider } from './components/Overlay';

const Company = lazy(() => import('./pages/Company'));
const Studio = lazy(() => import('./pages/Studio'));
const Progress = lazy(() => import('./pages/Progress'));
const Practice = lazy(() => import('./pages/Practice'));
const Ask = lazy(() => import('./pages/Ask'));
const Sprint = lazy(() => import('./pages/Sprint'));
const Profile = lazy(() => import('./pages/Profile'));
const Offers = lazy(() => import('./pages/Offers'));
const Status = lazy(() => import('./pages/Status'));
const More = lazy(() => import('./pages/More'));
const Resumes = lazy(() => import('./resume/Resumes'));

// Old links: /?r=File opened a resume; /hunt/... was the earlier Job Hunt address.
function Home() {
  const r = new URLSearchParams(useLocation().search).get('r');
  return r ? <Navigate to={`/resumes/${encodeURIComponent(r)}`} replace /> : <Today />;
}
function LegacyHunt() {
  const rest = useParams()['*'] ?? '';
  return <Navigate to={`/${rest}`} replace />;
}

function App() {
  const location = useLocation();
  return (
    <Shell location={location}>
      <Suspense fallback={<div className="flex items-center gap-2 text-ink-2"><Spinner />Loading…</div>}>
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/resumes/:file?" element={<Resumes />} />
          <Route path="/hunt/*" element={<LegacyHunt />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/new" element={<NewCompany />} />
          <Route path="/c/:id/:step?" element={<Company />} />
          <Route path="/studio/:id" element={<Studio />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/ask" element={<Ask />} />
          <Route path="/sprint/:tab?" element={<Sprint />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/status" element={<Status />} />
          <Route path="/more" element={<More />} />
          <Route path="*" element={<Today />} />
        </Routes>
      </Suspense>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><AuthGate><AppProvider><OverlayProvider><App /></OverlayProvider></AppProvider></AuthGate></BrowserRouter></StrictMode>,
);
