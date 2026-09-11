import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import useStore from '../../store/useStore';
import { SERVER_URL } from '../../utils/constants';
import { Video, Mail } from 'lucide-react';

export default function ForgotPasswordScreen() {
  const isLoggedIn = useStore((state) => state.isLoggedIn);

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [resetLink, setResetLink] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (isLoggedIn) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setResetLink(null);

    if (!email.trim()) {
      setError('Please enter your email');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`${SERVER_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim() })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Try again.');
        setIsSubmitting(false);
        return;
      }

      setSuccess('A reset link has been generated for your account.');
      setResetLink(data.resetLink || null);
      setIsSubmitting(false);
    } catch (err) {
      setError('Cannot reach the server. Is it running?');
      setIsSubmitting(false);
    }
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
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="text-gray-400 text-sm mt-1">Enter your email and we will generate a reset link.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-meeting-surface border border-meeting-border rounded-xl p-6 space-y-4">
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

          {error && (
            <p className="text-red-400 text-sm text-center bg-red-900/20 border border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {success && (
            <div className="space-y-2">
              <p className="text-emerald-400 text-sm text-center bg-emerald-900/20 border border-emerald-800/40 rounded-lg px-3 py-2">
                {success}
              </p>
              {resetLink && (
                <div>
                  <label className="text-sm text-gray-300 mb-1.5 block">Your reset link:</label>
                  <div className="w-full bg-meeting-bg border border-meeting-border rounded-lg px-3 py-2 text-xs text-primary break-all select-all">
                    {resetLink}
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Generating link...' : 'Generate reset link'}
          </button>
        </form>

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