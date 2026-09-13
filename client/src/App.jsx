import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useStore from './store/useStore';
import ErrorBoundary from './components/ui/ErrorBoundary';
import LoginScreen from './components/Auth/LoginScreen';
import ForgotPasswordScreen from './components/Auth/ForgotPasswordScreen';
import ResetPasswordScreen from './components/Auth/ResetPasswordScreen';
import HomeScreen from './components/Lobby/HomeScreen';
import LobbyScreen from './components/Lobby/LobbyScreen';
import MeetingRoom from './components/Meeting/MeetingRoom';

function RequireAuth({ children }) {
  const isLoggedIn = useStore((state) => state.isLoggedIn);
  const location = useLocation();

  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

function Toast() {
  const toast = useStore((state) => state.toast);
  const dismissToast = useStore((state) => state.dismissToast);
  if (!toast) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm animate-pop-in">
      <div className="flex items-center justify-between gap-3 bg-meeting-surface border border-red-800/50 text-gray-200 text-sm rounded-lg px-4 py-3 shadow-2xl">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
          <span className="truncate">{toast}</span>
        </span>
        <button
          onClick={dismissToast}
          className="text-gray-400 hover:text-white shrink-0 p-1"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Toast />
      <Routes>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
        <Route path="/reset-password" element={<ResetPasswordScreen />} />
        <Route path="/" element={<RequireAuth><HomeScreen /></RequireAuth>} />
        {/* Join + meeting routes are PUBLIC - guests can join via shared link without Admin login */}
        <Route path="/join" element={<LobbyScreen />} />
        <Route path="/meeting/:roomId" element={
          <ErrorBoundary>
            <MeetingRoom />
          </ErrorBoundary>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
