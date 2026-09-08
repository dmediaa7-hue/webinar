import React, { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { Video, Lock, User, Eye, EyeOff } from 'lucide-react';

const ADMIN_USERNAME = 'Admin';
const ADMIN_PASSWORD = 'Admin@02233';

export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useStore((state) => state.login);
  const isLoggedIn = useStore((state) => state.isLoggedIn);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordHint, setShowPasswordHint] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = location.state?.from?.pathname || '/';

  if (isLoggedIn) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password');
      return;
    }

    setIsSubmitting(true);

    if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      login(username.trim());
      navigate(from, { replace: true });
    } else {
      setError('Invalid username or password');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <Video size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Webinar</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to host or join meetings</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleSubmit} className="bg-meeting-surface border border-meeting-border rounded-xl p-6 space-y-4">
          <div>
            <label className="text-sm text-gray-300 mb-1.5 block">Username</label>
            <div className="relative">
              <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                placeholder="Enter username"
                autoFocus
                className="w-full pl-10 pr-4 py-2.5 bg-meeting-bg border border-meeting-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm text-gray-300">Password</label>
              <button
                type="button"
                onClick={() => setShowPasswordHint(!showPasswordHint)}
                className="text-xs text-primary hover:text-primary-light transition-colors"
              >
                Show hint
              </button>
            </div>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Enter password"
                className="w-full pl-10 pr-10 py-2.5 bg-meeting-bg border border-meeting-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {showPasswordHint && (
              <p className="text-xs text-gray-500 mt-1.5">
                Default credentials: Username <code className="text-primary">Admin</code>, Password{' '}
                <code className="text-primary">Admin@02233</code>
              </p>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600">
          Secure access · Host credentials required
        </p>
      </div>
    </div>
  );
}
