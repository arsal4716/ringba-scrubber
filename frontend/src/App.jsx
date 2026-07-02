import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import {
  Navbar, Nav, Container, Form, Button,
  Card, Alert, Spinner, InputGroup,
} from 'react-bootstrap';
import {
  FaLock, FaEye, FaEyeSlash, FaSignOutAlt, FaShieldAlt, FaBars,
  FaTachometerAlt, FaClock, FaBan, FaFileAlt, FaFolderOpen,
  FaFileExcel, FaPhoneAlt, FaBullseye, FaCog, FaShareSquare,
} from 'react-icons/fa';

import Dashboard from './pages/Dashboard';
import Schedule from './pages/Schedule';
import DNCUpload from './pages/DNCUpload';
import Files from './pages/Files';
import Admin from './pages/Admin';
import Targets from './pages/Targets';
import ScrubFiles from './pages/ScrubFiles';
import Kaliper from './pages/Kaliper';
import IdealConcept from './pages/IdealConcept';
import Publisher from './pages/Publisher';
import API from './services/api';

import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';

// ─────────────────────────────────────────────────────────────
// Auth Context
// ─────────────────────────────────────────────────────────────
const AuthContext = createContext(null);

const SESSION_KEY = 'rsp_admin_auth';

function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const login = () => {
    sessionStorage.setItem(SESSION_KEY, 'true');
    setAuthed(true);
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setAuthed(false);
  };

  return (
    <AuthContext.Provider value={{ authed, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

// ─────────────────────────────────────────────────────────────
// Protected Route wrapper
// ─────────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { authed } = useAuth();
  const location = useLocation();

  if (!authed) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

// ─────────────────────────────────────────────────────────────
// Login Page
// ─────────────────────────────────────────────────────────────
function LoginPage() {
  const { authed, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const from = location.state?.from?.pathname || '/dashboard';

  // Already logged in? Redirect away
  useEffect(() => {
    if (authed) navigate(from, { replace: true });
  }, [authed]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password) {
      setError('Please enter the admin password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await API.post('/auth/login', { password });
      login();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Incorrect password. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}
    >
      <Card className="shadow-lg border-0" style={{ width: '100%', maxWidth: 420 }}>
        <Card.Body className="p-5">
          {/* Logo */}
          <div className="text-center mb-4">
            <div
              className="bg-primary bg-gradient rounded-circle d-inline-flex align-items-center justify-content-center mb-3"
              style={{ width: 72, height: 72 }}
            >
              <FaShieldAlt size={30} color="white" />
            </div>
            <h4 className="fw-bold mb-1">Admin Access</h4>
            <p className="text-muted small mb-0">Ringba Scrub Platform — Protected Area</p>
          </div>

          {error && (
            <Alert variant="danger" className="py-2 small">
              <FaLock className="me-2" />{error}
            </Alert>
          )}

          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-4">
              <Form.Label className="fw-semibold text-secondary small text-uppercase letter-spacing">
                Admin Password
              </Form.Label>
              <InputGroup>
                <Form.Control
                  type={showPw ? 'text' : 'password'}
                  placeholder="Enter password"
                  size="lg"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                />
                <Button
                  variant="outline-secondary"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                >
                  {showPw ? <FaEyeSlash /> : <FaEye />}
                </Button>
              </InputGroup>
            </Form.Group>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-100 fw-semibold"
              disabled={loading}
            >
              {loading ? (
                <><Spinner size="sm" className="me-2" />Verifying...</>
              ) : (
                <><FaLock className="me-2" />Login</>
              )}
            </Button>
          </Form>

          <div className="text-center mt-4 pt-3 border-top">
            <Link to="/publisher" className="text-muted small text-decoration-none">
              📤 Go to Publisher Portal →
            </Link>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// App Shell (Navbar + Routes)
// ─────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: <FaTachometerAlt />, end: true },
  { to: '/schedule', label: 'Schedule', icon: <FaClock /> },
  { to: '/dnc-upload', label: 'DNC Upload', icon: <FaBan /> },
  { to: '/files', label: 'Files', icon: <FaFileAlt /> },
  { to: '/scrub-files', label: 'Scrub Files', icon: <FaFolderOpen /> },
  { to: '/kaliper', label: 'Kaliper', icon: <FaFileExcel /> },
  { to: '/ideal-concept', label: 'IdealConcept', icon: <FaPhoneAlt /> },
  { to: '/targets', label: 'Targets', icon: <FaBullseye /> },
  { to: '/admin', label: 'Admin', icon: <FaCog /> },
];

function AppShell() {
  const { authed, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Don't show the sidebar on the public publisher portal (root) or login.
  const isPublicPage =
    location.pathname === '/' ||
    location.pathname === '/publisher' ||
    location.pathname === '/login';

  // Close the mobile sidebar whenever the route changes.
  useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const showChrome = !isPublicPage && authed;

  return (
    <div className="app-shell">
      {showChrome && (
        <>
          {/* ── Mobile top bar (hamburger) ─────────────────── */}
          <div className="topbar-mobile">
            <Button variant="link" className="text-white p-0" onClick={() => setSidebarOpen(true)}>
              <FaBars size={22} />
            </Button>
            <span className="fw-bold">📞 Ringba Scrub</span>
          </div>

          {/* ── Sidebar ────────────────────────────────────── */}
          <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
            <div className="sidebar-brand">
              <span className="brand-badge"><FaShieldAlt color="#fff" /></span>
              <span>Ringba Scrub</span>
            </div>

            <nav className="sidebar-nav">
              {NAV_ITEMS.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className="sidebar-link"
                >
                  <span className="sidebar-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </NavLink>
              ))}

              <div className="sidebar-heading">External</div>
              <a
                className="sidebar-link"
                href="/publisher"
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="sidebar-icon"><FaShareSquare /></span>
                <span>Publisher ↗</span>
              </a>
            </nav>

            <div className="sidebar-footer">
              <button className="sidebar-link w-100 border-0 bg-transparent" onClick={handleLogout}>
                <span className="sidebar-icon"><FaSignOutAlt /></span>
                <span>Logout</span>
              </button>
            </div>
          </aside>

          {/* Backdrop (mobile, when sidebar open) */}
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        </>
      )}

      <div className={showChrome ? 'main-content' : ''}>
        {/* ── Routes ──────────────────────────────────────── */}
        <Routes>
        {/* ── PUBLIC: Publisher portal is the landing page (root) ── */}
        <Route path="/" element={<Publisher />} />
        <Route path="/publisher" element={<Publisher />} />

        {/* ── PUBLIC: Login ── */}
        <Route path="/login" element={<LoginPage />} />

        {/* ── PROTECTED: all admin/internal routes ── */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute>
              <Schedule />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dnc-upload"
          element={
            <ProtectedRoute>
              <DNCUpload />
            </ProtectedRoute>
          }
        />
        <Route
          path="/files"
          element={
            <ProtectedRoute>
              <Files />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scrub-files"
          element={
            <ProtectedRoute>
              <ScrubFiles />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kaliper"
          element={
            <ProtectedRoute>
              <Kaliper />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ideal-concept"
          element={
            <ProtectedRoute>
              <IdealConcept />
            </ProtectedRoute>
          }
        />
        <Route
          path="/targets"
          element={
            <ProtectedRoute>
              <Targets />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <Admin />
            </ProtectedRoute>
          }
        />

        {/* ── Fallback ── */}
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────
function App() {
  return (
    <AuthProvider>
      <Router>
        <AppShell />
      </Router>
    </AuthProvider>
  );
}

export default App;
