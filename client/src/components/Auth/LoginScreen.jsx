import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { SERVER_URL } from '../../utils/constants';
import { Video, Lock, User, Mail, Eye, EyeOff } from 'lucide-react';

export default function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useStore((state) => state.login);
  const isLoggedIn = useStore((state) => state.isLoggedIn);

  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const from = location.state?.from?.pathname || '/';

  // Restore a persisted session (httpOnly cookie may still be valid).
  useEffect(() => {
    let cancelled = false;
    fetch(`${SERVER_URL}/api/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.user) return;
        login(data.user);
        navigate(from, { replace: true });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (isLoggedIn) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please enter both email and password');
      return;
    }
    if (mode === 'register') {
      if (!name.trim()) {
        setError('Please enter your name');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = mode === 'register'
        ? { name: name.trim(), email: email.trim(), password }
        : { email: email.trim(), password };

      const res = await fetch(`${SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        setIsSubmitting(false);
        return;
      }

      login(data.user);
      navigate(from, { replace: true });
    } catch (err) {
      setError('Cannot reach the server. Is it running?');
      setIsSubmitting(false);
    }
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
  };

  const inputClass =
    'w-full pl-10 pr-4 py-2.5 bg-meeting-bg border border-meeting-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary transition-all';

  return (
    <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <Video size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Webinar</h1>
          <p className="text-gray-400 text-sm mt-1">
            {mode === 'login' ? 'Sign in to host or join meetings' : 'Create your account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-meeting-surface border border-meeting-border rounded-xl p-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label className="text-sm text-gray-300 mb-1.5 block">Name</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setError(''); }}
                  placeholder="Your display name"
                  className={inputClass}
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-sm text-gray-300 mb-1.5 block">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                placeholder="you@example.com"
                autoFocus
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-300 mb-1.5 block">Password</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder={mode === 'register' ? 'At least 8 characters' : 'Enter password'}
                className={inputClass}
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
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-sm text-gray-300 mb-1.5 block">Confirm Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                  placeholder="Repeat your password"
                  className={inputClass}
                />
              </div>
            </div>
          )}

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
            {isSubmitting ? (mode === 'login' ? 'Signing in...' : 'Creating account...') : (mode === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="text-center">
          {mode === 'login' ? (
            <button
              onClick={() => switchMode('register')}
              className="text-sm text-primary hover:text-primary-light transition-colors"
            >
              New here? <span className="font-medium">Create an account</span>
            </button>
          ) : (
            <button
              onClick={() => switchMode('login')}
              className="text-sm text-primary hover:text-primary-light transition-colors"
            >
              Already have an account? <span className="font-medium">Sign in</span>
            </button>
          )}
        </div>

        <p className="text-center text-xs text-gray-600">
          Accounts are stored securely with hashed passwords
        </p>
      </div>
    </div>
  );
}