import useStore from '../store/useStore';
import { SERVER_URL } from './constants';

// Wraps the backend API for authenticated calls. Attaches the session cookie
// and, when an expired/invalid session causes a 401 on a non-auth endpoint,
// clears the client-side auth state and returns to /login instead of silently
// failing (stale sessions happen when the server DB is reset on redeploy).
export default async function apiFetch(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    credentials: 'include',
    ...options
  });
  if (res.status === 401 && useStore.getState().isLoggedIn && !path.startsWith('/api/auth/')) {
    useStore.getState().logout();
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
  return res;
}