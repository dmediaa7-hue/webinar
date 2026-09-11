import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import useStore from './store/useStore';
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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
      <Route path="/" element={<RequireAuth><HomeScreen /></RequireAuth>} />
      {/* Join + meeting routes are PUBLIC - guests can join via shared link without Admin login */}
      <Route path="/join" element={<LobbyScreen />} />
      <Route path="/meeting/:roomId" element={<MeetingRoom />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
