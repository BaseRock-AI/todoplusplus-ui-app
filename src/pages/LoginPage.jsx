import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import BrandHeader from '../components/BrandHeader';
import { setToken } from '../services/auth';
import { api } from '../services/api';

const defaultCreds = [
  { role: 'Admin', username: 'admin', password: 'password123' },
  { role: 'User', username: 'user', password: 'password123' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/auth/login', {
        username: form.username,
        password: form.password,
      });
      setToken(response.data.access_token);
      navigate('/todos');
    } catch (err) {
      const detail = err?.response?.data?.detail;
      let message = 'Login failed. Check credentials.';

      if (!err?.response) {
        message = `Cannot reach backend at ${api.defaults.baseURL}. Start backend or fix VITE_API_BASE_URL.`;
      } else if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail) && detail.length > 0) {
        message = detail[0]?.msg || message;
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function fillCredentials(username, password) {
    setForm({ username, password });
  }

  return (
    <main className="page app-shell">
      <BrandHeader showAuthAction={false} />

      <section className="panel login-panel">
        <h1 className="page-title">Welcome to ToDo ++</h1>
        <p className="subtitle">Login to continue. Use admin or normal user credentials below.</p>

        <div className="cred-grid">
          {defaultCreds.map((item) => (
            <button
              key={item.role}
              className="cred-card"
              onClick={() => fillCredentials(item.username, item.password)}
              type="button"
            >
              <strong>{item.role}</strong>
              <span>Username: {item.username}</span>
              <span>Password: {item.password}</span>
              <span className="tap-hint">Click to auto-fill</span>
            </button>
          ))}
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>

          <button className="primary-btn" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Login'}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </main>
  );
}
