import React from 'react';
import { HashRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsPage } from './pages/SettingsPage';
import { SpinnerPage } from './pages/SpinnerPage';

function Navbar() {
  const location = useLocation();
  const isSpinnerActive = location.pathname === '/' || location.pathname === '/spinner';
  const isSettingsActive = location.pathname === '/settings';

  return (
    <header className="sticky top-0 z-40 border-b border-amber-400/20 bg-[#070B19]/95 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        <Link
          to="/"
          className="font-display text-2xl font-bold tracking-tight text-amber-300 whitespace-nowrap shrink-0 hover:text-amber-200 transition-colors"
        >
          JMEG Events
        </Link>

        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link
            to="/"
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              isSpinnerActive
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            Spinner
          </Link>
          <Link
            to="/settings"
            className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors ${
              isSettingsActive
                ? 'border-amber-400 text-amber-300'
                : 'border-transparent text-slate-300 hover:text-white'
            }`}
          >
            Settings
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col bg-[#070B19] text-slate-100">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<SpinnerPage />} />
            <Route path="/spinner" element={<SpinnerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<Navigate to="/settings" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="border-t border-slate-800/80 py-6 px-4 sm:px-8 text-center text-xs text-slate-500">
          JMEG Events · Prize Spinner
        </footer>
      </div>
    </HashRouter>
  );
}
