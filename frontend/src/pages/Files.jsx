import React, { useState, useEffect } from 'react';
import { Container, Table, Button, Alert, Badge, Card, Form, Row, Col } from 'react-bootstrap';
import { FaDownload, FaTrash, FaFileAlt, FaSyncAlt } from 'react-icons/fa';
import API from '../services/api';

const Files = () => {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [date, setDate] = useState('');

  useEffect(() => {
    fetchFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll, date]);

  const fetchFiles = async () => {
    try {
      const params = {};
      if (date) params.date = date;       // a specific day
      else if (showAll) params.all = true; // everything
      // else: default = latest run only
      const { data } = await API.get('/files', { params });
      setFiles(data);
    } catch (err) {
      setError('Failed to load files');
    }
  };

  const clearFilters = () => {
    setDate('');
    setShowAll(false);
  };

  const handleDownload = (id, fileName) => {
    window.open(`${API.defaults.baseURL}/files/${id}/download`);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this file?')) return;
    try {
      await API.delete(`/files/${id}`);
      setFiles(files.filter(f => f._id !== id));
    } catch (err) {
      setError('Delete failed');
    }
  };

  const getFetchTypeBadge = (type) => {
    switch(type) {
      case '45days': return <Badge bg="info">Last 45 Days</Badge>;
      case '1year': return <Badge bg="primary">Last 1 Year</Badge>;
      case 'combined': return <Badge bg="secondary">Combined</Badge>;
      default: return <Badge bg="secondary">{type}</Badge>;
    }
  };

  return (
    <Container className="mt-5">
      <div className="d-flex align-items-center mb-4">
        <FaFileAlt size={30} className="text-primary me-3" />
        <h2 className="fw-bold mb-0">Generated Files</h2>
      </div>

      {/* ── Filters ──────────────────────────────────────────── */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={3}>
              <Form.Label className="fw-semibold small">Date</Form.Label>
              <Form.Control type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Col>
            <Col md={3}>
              <Form.Check
                type="switch"
                label="Show all runs"
                checked={showAll}
                disabled={!!date}
                onChange={(e) => setShowAll(e.target.checked)}
              />
            </Col>
            <Col md={3}>
              <Button variant="outline-secondary" size="sm" onClick={clearFilters}>
                <FaSyncAlt className="me-1" />Latest run only
              </Button>
            </Col>
          </Row>
          <p className="text-muted small mb-0 mt-2">
            {date ? `Showing files for ${date}.` : showAll ? 'Showing all files.' : 'Showing the latest run only — pick a date or toggle “Show all” to see more.'}
          </p>
        </Card.Body>
      </Card>

      {error && <Alert variant="danger">{error}</Alert>}

      {files.length === 0 ? (
        <Card className="text-center p-5">
          <Card.Body>
            <p className="text-muted mb-0">No files generated yet.</p>
          </Card.Body>
        </Card>
      ) : (
        <Card>
          <Card.Body className="p-0">
            <Table hover responsive className="mb-0">
              <thead>
                <tr>
                  <th>File Name</th>
                  <th>Campaign</th>
                  <th>Fetch Type</th>
                  <th className="text-center">Numbers</th>
                  <th>Created Date</th>
                  <th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => (
                  <tr key={file._id}>
                    <td className="fw-medium">{file.fileName}</td>
                    <td>{file.campaignName}</td>
                    <td>{getFetchTypeBadge(file.fetchType)}</td>
                    <td className="text-center fw-bold">{file.totalNumbers}</td>
                    <td>{new Date(file.createdAt).toLocaleString()}</td>
                    <td className="text-center">
                      <Button 
                        variant="success" 
                        size="sm" 
                        onClick={() => handleDownload(file._id, file.fileName)} 
                        className="me-2 px-3"
                      >
                        <FaDownload />
                      </Button>
                      <Button 
                        variant="danger" 
                        size="sm" 
                        onClick={() => handleDelete(file._id)}
                        className="px-3"
                      >
                        <FaTrash />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
};

export default Files;