import React, { useState } from 'react';
import { Container, Form, Button, Card, Alert, Row, Col } from 'react-bootstrap';
import { FaUpload, FaCheckCircle, FaTimesCircle } from 'react-icons/fa';
import API from '../services/api';

const DNCUpload = () => {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;

    const formData = new FormData();
    formData.append('dncFile', file);

    setUploading(true);
    setError('');
    setResult(null);

    try {
      const { data } = await API.post('/dnc/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-center">
        <Col md={8} lg={6}>
          <Card>
            <Card.Body className="p-4">
              <div className="text-center mb-4">
                <h2 className="fw-bold">📁 Upload DNC File</h2>
                <p className="text-muted">CSV or XLSX files only</p>
              </div>
              <Form onSubmit={handleUpload}>
                <Form.Group className="mb-4">
                  <Form.Label className="fw-semibold">Select file</Form.Label>
                  <Form.Control 
                    type="file" 
                    accept=".csv,.xlsx" 
                    onChange={handleFileChange} 
                    required 
                    className="py-2"
                  />
                </Form.Group>
                <div className="d-grid">
                  <Button 
                    variant="primary" 
                    type="submit" 
                    disabled={!file || uploading}
                    size="lg"
                  >
                    {uploading ? 'Uploading...' : <><FaUpload className="me-2" />Upload DNC</>}
                  </Button>
                </div>
              </Form>

              {error && (
                <Alert variant="danger" className="mt-4 d-flex align-items-center">
                  <FaTimesCircle className="me-2" size={20} />
                  {error}
                </Alert>
              )}

              {result && (
                <Alert variant="success" className="mt-4">
                  <div className="d-flex align-items-center mb-2">
                    <FaCheckCircle className="me-2" size={20} />
                    <strong>Upload successful!</strong>
                  </div>
                  <Row className="mt-3">
                    <Col xs={6}>Total numbers:</Col>
                    <Col xs={6} className="fw-bold">{result.totalNumbers}</Col>
                    <Col xs={6}>Unique numbers:</Col>
                    <Col xs={6} className="fw-bold">{result.uniqueNumbers}</Col>
                    <Col xs={6}>Inserted:</Col>
                    <Col xs={6} className="fw-bold text-success">{result.inserted}</Col>
                    <Col xs={6}>Duplicates ignored:</Col>
                    <Col xs={6} className="fw-bold text-warning">{result.duplicatesIgnored}</Col>
                  </Row>
                </Alert>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default DNCUpload;