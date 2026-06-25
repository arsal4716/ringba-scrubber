import React, { useState } from 'react';
import { Container, Row, Col, Card, Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { FaPlay, FaFileExcel, FaExclamationTriangle } from 'react-icons/fa';
import API from '../services/api';

// Yesterday as YYYY-MM-DD (UTC) — matches the report's default window.
const yesterdayStr = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const Kaliper = () => {
  const [date, setDate] = useState(yesterdayStr());
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);

  const run = async () => {
    setRunning(true);
    setError('');
    setSummary(null);
    try {
      const resp = await API.post(
        '/kaliper/run',
        { date },
        { responseType: 'blob', timeout: 1000 * 60 * 10 } // up to 10 min
      );

      // Parse the summary header if present.
      try {
        const hdr = resp.headers['x-kaliper-summary'];
        if (hdr) setSummary(JSON.parse(hdr));
      } catch { /* non-fatal */ }

      // Trigger browser download from the returned blob.
      const blob = new Blob([resp.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Suppressed_CallerIDs_${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      // Error responses come back as a blob — read it as text/JSON.
      let msg = 'Run failed';
      try {
        const text = await err.response?.data?.text?.();
        if (text) msg = JSON.parse(text).error || msg;
      } catch {
        msg = err.response?.statusText || err.message || msg;
      }
      setError(msg);
    } finally {
      setRunning(false);
    }
  };

  const stat = (label, value, color = 'primary') => (
    <Col xs={6} md={4} className="mb-3">
      <Card className="text-center h-100">
        <Card.Body className="py-3">
          <div className={`fw-bold fs-4 text-${color}`}>{(value ?? 0).toLocaleString()}</div>
          <div className="text-muted small">{label}</div>
        </Card.Body>
      </Card>
    </Col>
  );

  return (
    <Container className="mt-5">
      <div className="d-flex align-items-center mb-4">
        <FaFileExcel size={26} className="text-success me-2" />
        <h2 className="fw-bold mb-0">Kaliper — Suppressed CallerIDs</h2>
      </div>

      <Card className="mb-4">
        <Card.Body>
          <p className="text-muted">
            Pulls suppressed caller IDs directly from the Kaliper MCP server
            (LeadMarket “CallerId Blocked” + HealthConnect “phs_suppressed”),
            then downloads an Excel workbook with per-buyer sheets, a summary,
            and the overlap list.
          </p>
          <Row className="g-3 align-items-end">
            <Col md={4}>
              <Form.Label className="fw-semibold small">Report date</Form.Label>
              <Form.Control
                type="date"
                value={date}
                max={yesterdayStr()}
                onChange={(e) => setDate(e.target.value)}
                disabled={running}
              />
              <Form.Text className="text-muted">
                Window: {date} 04:00 UTC → next day 04:00 UTC (ET midnight-to-midnight)
              </Form.Text>
            </Col>
            <Col md={4}>
              <Button variant="success" size="lg" onClick={run} disabled={running}>
                {running ? (
                  <><Spinner size="sm" className="me-2" />Running…</>
                ) : (
                  <><FaPlay className="me-2" />Run Now</>
                )}
              </Button>
            </Col>
          </Row>

          {running && (
            <Alert variant="info" className="mt-3 mb-0 small">
              Fetching from Kaliper and building the workbook — this can take a
              minute for busy days. The file downloads automatically when done.
            </Alert>
          )}

          {error && (
            <Alert variant="danger" className="mt-3 mb-0 d-flex align-items-center">
              <FaExclamationTriangle className="me-2" />{error}
            </Alert>
          )}
        </Card.Body>
      </Card>

      {summary && (
        <Card>
          <Card.Body>
            <div className="d-flex align-items-center mb-3">
              <Card.Title className="mb-0">Last run</Card.Title>
              <Badge bg="success" className="ms-2">Downloaded</Badge>
            </div>
            <Row>
              {stat('LeadMarket rows', summary.lmRows, 'primary')}
              {stat('LeadMarket unique', summary.lmUnique, 'info')}
              {stat('HealthConnect rows', summary.hcRows, 'success')}
              {stat('HealthConnect unique', summary.hcUnique, 'info')}
              {stat('Overlap (both lists)', summary.overlap, 'warning')}
              {stat('Pings scanned', (summary.lmPingsScanned || 0) + (summary.hcPingsScanned || 0), 'secondary')}
            </Row>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
};

export default Kaliper;
