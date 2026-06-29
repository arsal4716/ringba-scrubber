import React, { useState, useEffect, useRef } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner, Badge, ProgressBar, Table } from 'react-bootstrap';
import { FaPlay, FaFileExcel, FaExclamationTriangle, FaFileDownload, FaSyncAlt } from 'react-icons/fa';
import API from '../services/api';

// "Today" in Eastern time (YYYY-MM-DD) so the picker matches EST, not UTC.
const estToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

const statusBadge = (s) => {
  const map = { completed: 'success', processing: 'warning', queued: 'secondary', failed: 'danger' };
  return <Badge bg={map[s] || 'secondary'} className="text-capitalize">{s}</Badge>;
};

const Kaliper = () => {
  const [startDate, setStartDate] = useState(estToday());
  const [endDate, setEndDate] = useState(estToday());
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState([]);
  const [active, setActive] = useState(null); // currently-tracked job
  const pollRef = useRef(null);

  const loadJobs = async () => {
    try {
      const { data } = await API.get('/reports', { params: { type: 'kaliper' } });
      const list = data.jobs || [];
      setJobs(list);
      // Resume tracking any in-flight job (reload-safe).
      const running = list.find((j) => j.status === 'processing' || j.status === 'queued');
      if (running && (!active || active._id !== running._id)) startPolling(running._id);
      return list;
    } catch {
      return [];
    }
  };

  const startPolling = (jobId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = async () => {
      try {
        const { data } = await API.get(`/reports/${jobId}`);
        setActive(data);
        if (data.status === 'completed' || data.status === 'failed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          loadJobs();
        }
      } catch { /* keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
  };

  useEffect(() => {
    loadJobs();
    return () => pollRef.current && clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    setStarting(true);
    setError('');
    try {
      const { data } = await API.post('/reports/run', { type: 'kaliper', startDate, endDate });
      await loadJobs();
      startPolling(data.jobId);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start');
    } finally {
      setStarting(false);
    }
  };

  const downloadUrl = (id) => `${API.defaults.baseURL}/reports/${id}/download`;
  const isBusy = active && (active.status === 'processing' || active.status === 'queued');

  return (
    <Container className="mt-5">
      <div className="d-flex align-items-center mb-4">
        <FaFileExcel size={26} className="text-success me-2" />
        <h2 className="fw-bold mb-0">Kaliper — Suppressed CallerIDs</h2>
      </div>

      <Card className="mb-4">
        <Card.Body>
          <p className="text-muted">
            Pulls suppressed caller IDs from Kaliper (LeadMarket “CallerId Blocked”
            + HealthConnect “phs_suppressed”) for a custom date range and builds a
            downloadable Excel workbook. You can leave this page — the file stays
            available below once it’s ready.
          </p>
          <Row className="g-3 align-items-end">
            <Col md={3}>
              <Form.Label className="fw-semibold small">Start date</Form.Label>
              <Form.Control type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)} disabled={isBusy} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-semibold small">End date</Form.Label>
              <Form.Control type="date" value={endDate} min={startDate} max={estToday()} onChange={(e) => setEndDate(e.target.value)} disabled={isBusy} />
            </Col>
            <Col md={3}>
              <Button variant="success" size="lg" onClick={run} disabled={starting || isBusy}>
                {starting ? <><Spinner size="sm" className="me-2" />Starting…</> : <><FaPlay className="me-2" />Run Now</>}
              </Button>
            </Col>
          </Row>

          {error && (
            <Alert variant="danger" className="mt-3 mb-0 d-flex align-items-center">
              <FaExclamationTriangle className="me-2" />{error}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {/* ── Live progress for the tracked job ─────────────────── */}
      {active && isBusy && (
        <Card className="mb-4 border-warning">
          <Card.Body>
            <div className="d-flex justify-content-between mb-2">
              <span className="fw-semibold">{active.label || 'Running…'}</span>
              <span className="text-muted small">{active.phase || 'Working…'}</span>
            </div>
            <ProgressBar
              now={active.percent || 0}
              label={`${active.percent || 0}%`}
              animated
              striped
              variant="warning"
            />
            <div className="text-muted small mt-2">
              {(active.fetched || 0).toLocaleString()} records fetched so far — you can safely leave this page.
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ── History / downloads ───────────────────────────────── */}
      <Card>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <Card.Title className="mb-0">Generated files</Card.Title>
            <Button variant="outline-secondary" size="sm" onClick={loadJobs}>
              <FaSyncAlt className="me-1" />Refresh
            </Button>
          </div>
          {jobs.length === 0 ? (
            <p className="text-muted mb-0">No reports yet. Pick a date range and hit Run Now.</p>
          ) : (
            <Table striped hover responsive size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Report</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Records</th>
                  <th>Fetched</th>
                  <th className="text-center">Download</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j._id}>
                    <td>
                      <div className="fw-semibold">{j.label}</div>
                      {j.status === 'failed' && <div className="text-danger small">{j.error}</div>}
                      {j.status === 'processing' && <div className="text-muted small">{j.phase} · {j.percent || 0}%</div>}
                    </td>
                    <td className="text-center">{statusBadge(j.status)}</td>
                    <td className="text-center">{(j.recordCount || 0).toLocaleString()}</td>
                    <td className="small text-muted">{j.completedAt ? new Date(j.completedAt).toLocaleString() : '—'}</td>
                    <td className="text-center">
                      {j.status === 'completed' && j.fileName ? (
                        <a href={downloadUrl(j._id)} className="btn btn-sm btn-outline-success" title={j.fileName}>
                          <FaFileDownload />
                        </a>
                      ) : (
                        <span className="text-muted small">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Kaliper;
