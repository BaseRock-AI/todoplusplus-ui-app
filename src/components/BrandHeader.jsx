import { useNavigate } from 'react-router-dom';

import { clearToken, getToken } from '../services/auth';

export default function BrandHeader({
  onLogout,
  showHomeButton = false,
  userText = '',
  showAuthAction = true,
}) {
  const navigate = useNavigate();
  const isLoggedIn = Boolean(getToken());

  function handleLogout() {
    clearToken();
    if (onLogout) onLogout();
    navigate('/');
  }

  return (
    <header className="brand-header panel">
      <img src="/brlogo.png" alt="BaseRock.ai" className="brand-logo" />
      <div className="top-actions">
        {userText ? <span className="top-user-text">{userText}</span> : null}
        {showHomeButton && isLoggedIn ? (
          <button className="ghost-btn" onClick={() => navigate('/todos')}>
            Home
          </button>
        ) : null}

        {showAuthAction && isLoggedIn ? (
          <button className="primary-btn" onClick={handleLogout}>
            Logout
          </button>
        ) : showAuthAction ? (
          <button className="primary-btn" onClick={() => navigate('/')}>
            Login
          </button>
        ) : null}
      </div>
    </header>
  );
}
