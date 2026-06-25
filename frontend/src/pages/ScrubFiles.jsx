import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Form, Badge, Button, Spinner } from 'react-bootstrap';
import { FaFileDownload, FaFolderOpen, FaSyncAlt } from 'react-icons/fa';
import API from '../services/api';

// Today's date as YYYY-MM-DD (local).
const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

const statusBadge = (s) => {
  const map = { completed: 'success', processing: 'warning', queued: 'secondary', failed: 'danger' };
  return <Badge bg={map[s] || 'secondary'} className="text-capitalize">{s}</Badge>;
};

const ScrubFiles = () => {
  const [date, setDate] = useState(todayStr());
  const [publisher, setPublisher] = useState('');
  const [publishers, setPublishers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);

  // Publisher dropdown options (loaded once).
  useEffect(() => {
    API.get('/admin/publishers')
      .then(({ data }) => setPublishers(data.publishers || []))
      .catch(() => setPublishers([]));
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const params = { date };
      if (publisher) params.publisherName = publisher;
      const { data } = await API.get('/admin/scrub-jobs', { params });
      setJobs(data.jobs || []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
    }
  };

  // Refetch whenever the filters change.
  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, publisher]);

  const downloadUrl = (id) => `${API.defaults.baseURL}/publisher/job/${id}/download`;

  return (
    <Container className="mt-5">
      <div className="d-flex align-items-center mb-4">
        <FaFolderOpen size={26} className="text-warning me-2" />
        <h2 className="fw-bold mb-0">Publisher Scrub Files</h2>
      </div>

      {/* ── Filters ──────────────────────────────────────────── */}
      <Card className="mb-4">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={4}>
              <Form.Label className="fw-semibold small">Date</Form.Label>
              <Form.Control type="date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} />
            </Col>
            <Col md={4}>
              <Form.Label className="fw-semibold small">Publisher</Form.Label>
              <Form.Select value={publisher} onChange={(e) => setPublisher(e.target.value)}>
                <option value="">All publishers</option>
                {publishers.map((p) => (
                  <option key={p._id} value={p.publisherName}>{p.publisherName}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md={4}>
              <Button variant="outline-primary" onClick={fetchJobs} disabled={loading}>
                <FaSyncAlt className={`me-2 ${loading ? 'fa-spin' : ''}`} />Refresh
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* ── Results ──────────────────────────────────────────── */}
      <Card>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <Card.Title className="mb-0">Files for {date}</Card.Title>
            <Badge bg="info">{jobs.length} file{jobs.length === 1 ? '' : 's'}</Badge>
          </div>

          {loading ? (
            <div className="text-center py-5"><Spinner /></div>
          ) : jobs.length === 0 ? (
            <p className="text-muted mb-0">No scrub files for the selected day/publisher.</p>
          ) : (
            <Table striped hover responsive size="sm" className="align-middle">
              <thead>
                <tr>
                  <th>Publisher</th>
                  <th>Campaign</th>
                  <th>File</th>
                  <th className="text-center">Status</th>
                  <th className="text-center">Rows</th>
                  <th className="text-center text-success">Not Dup</th>
                  <th className="text-center text-warning">Dup</th>
                  <th className="text-center text-danger">DNC</th>
                  <th className="text-center">Time</th>
                  <th className="text-center">Download</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j._id}>
                    <td className="fw-semibold">{j.publisherName}</td>
                    <td>{j.campaign}</td>
                    <td className="text-truncate" style={{ maxWidth: 200 }} title={j.originalFileName}>
                      {j.originalFileName}
                    </td>
                    <td className="text-center">{statusBadge(j.status)}</td>
                    <td className="text-center">{(j.totalRows || 0).toLocaleString()}</td>
                    <td className="text-center text-success">{(j.nonDuplicateCount || 0).toLocaleString()}</td>
                    <td className="text-center text-warning">{(j.duplicateCount || 0).toLocaleString()}</td>
                    <td className="text-center text-danger">{(j.dncCount || 0).toLocaleString()}</td>
                    <td className="text-center small text-muted">
                      {new Date(j.createdAt).toLocaleTimeString()}
                    </td>
                    <td className="text-center">
                      {j.status === 'completed' && j.downloadFilePath ? (
                        <a href={downloadUrl(j._id)} className="btn btn-sm btn-outline-success" title="Download scrubbed file">
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

export default ScrubFiles;
