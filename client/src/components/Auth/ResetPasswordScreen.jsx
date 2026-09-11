import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SERVER_URL } from '../../utils/constants';
import { Video, Lock, Eye, EyeOff } from 'lucide-react';

export default function ResetPasswordScreen() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputClass =
    'w-full pl-10 pr-4 py-2.5 bg-meeting-bg border border-meeting-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary transition-all';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || !confirmPassword) {
      setError('Please enter both password fields');
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

    setIsSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        setIsSubmitting(false);
        return;
      }

      setSuccess('Your password has been updated. You can now sign in.');
      setIsSubmitting(false);
    } catch (err) {
      setError('Cannot reach the server. Is it running?');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-screen-min bg-meeting-bg flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <Video size={32} className="text-primary" />
          </div>
          <h1 className="text-2xl font-bold">Set a new password</h1>
          <p className="text-gray-400 text-sm mt-1">Enter a new password (at least 8 characters).</p>
        </div>

        {!token ? (
          <div className="bg-meeting-surface border border-meeting-border rounded-xl p-6 space-y-4">
            <p className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              This reset link is invalid or missing.
            </p>
            <div className="text-center">
              <Link to="/forgot-password" className="text-sm text-primary hover:text-primary-light transition-colors">
                Request a new reset link
              </Link>
            </div>
          </div>
        ) : success ? (
          <div className="bg-meeting-surface border border-meeting-border rounded-xl p-6 space-y-4">
            <p className="text-emerald-400 text-sm text-center bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
              {success}
            </p>
            <Link
              to="/login"
              className="block w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors text-center"
            >
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-meeting-surface border border-meeting-border rounded-xl p-6 space-y-4">
            <div>
              <label className="text-sm text-gray-300 mb-1.5 block">New Password</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="At least 8 characters"
                  autoFocus
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

            <div>
              <label className="text-sm text-gray-300 mb-1.5 block">Confirm New Password</label>
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
              {isSubmitting ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}

        <div className="text-center">
          <Link to="/login" className="text-sm text-primary hover:text-primary-light transition-colors">
            Back to login
          </Link>
        </div>

        <p className="text-center text-xs text-gray-600">
          Accounts are stored securely with hashed passwords
        </p>
      </div>
    </div>
  );
}