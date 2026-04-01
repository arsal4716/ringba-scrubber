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
import { FaLock, FaEye, FaEyeSlash, FaSignOutAlt, FaShieldAlt } from 'react-icons/fa';

import Dashboard from './pages/Dashboard';
import Schedule from './pages/Schedule';
import DNCUpload from './pages/DNCUpload';
import Files from './pages/Files';
import Admin from './pages/Admin';
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

  const from = location.state?.from?.pathname || '/';

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
function AppShell() {
  const { authed, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show the main navbar on login page or publisher page
  const isPublicPage =
    location.pathname === '/publisher' || location.pathname === '/login';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      {/* ── Navbar: only shown on protected pages ─────────── */}
      {!isPublicPage && authed && (
        <Navbar bg="dark" variant="dark" expand="lg" className="py-3 shadow-sm">
          <Container>
            <Navbar.Brand as={Link} to="/" className="fw-bold">
              📞 Ringba Scrub Platform
            </Navbar.Brand>
            <Navbar.Toggle aria-controls="main-nav" />
            <Navbar.Collapse id="main-nav">
              <Nav className="ms-auto gap-1 align-items-lg-center">
                <Nav.Link as={NavLink} to="/" end className="px-3">Dashboard</Nav.Link>
                <Nav.Link as={NavLink} to="/schedule" className="px-3">Schedule</Nav.Link>
                <Nav.Link as={NavLink} to="/dnc-upload" className="px-3">DNC Upload</Nav.Link>
                <Nav.Link as={NavLink} to="/files" className="px-3">Files</Nav.Link>
                <Nav.Link as={NavLink} to="/admin" className="px-3 text-warning fw-semibold">
                  ⚙️ Admin
                </Nav.Link>
                <Nav.Link
                  as={Link}
                  to="/publisher"
                  className="px-3 text-info fw-semibold"
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Opens Publisher Portal in new tab"
                >
                  📤 Publisher ↗
                </Nav.Link>
                <Button
                  variant="outline-danger"
                  size="sm"
                  className="ms-2 px-3"
                  onClick={handleLogout}
                >
                  <FaSignOutAlt className="me-1" />Logout
                </Button>
              </Nav>
            </Navbar.Collapse>
          </Container>
        </Navbar>
      )}

      {/* ── Routes ────────────────────────────────────────── */}
      <Routes>
        {/* ── PUBLIC: Publisher portal ── */}
        <Route path="/publisher" element={<Publisher />} />

        {/* ── PUBLIC: Login ── */}
        <Route path="/login" element={<LoginPage />} />

        {/* ── PROTECTED: all admin/internal routes ── */}
        <Route
          path="/"
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
    </>
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
