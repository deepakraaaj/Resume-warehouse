import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import './index.css';
import { AppProvider } from './lib/state';
import { Shell } from './components/Shell';
import Today from './pages/Today';
import { Companies, NewCompany } from './pages/Companies';
import { Spinner } from './components/ui';

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

function App() {
  const location = useLocation();
  return (
    <Shell location={location}>
      <Suspense fallback={<div className="flex items-center gap-2 text-ink-2"><Spinner />Loading…</div>}>
        <Routes location={location}>
          <Route path="/" element={<Today />} />
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
  <StrictMode><BrowserRouter basename="/hunt"><AppProvider><App /></AppProvider></BrowserRouter></StrictMode>,
);
