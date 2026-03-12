import React, { useState, useEffect } from 'react';
import { Container, Table, Button, Alert, Badge,Card } from 'react-bootstrap';
import { FaDownload, FaTrash, FaFileAlt } from 'react-icons/fa';
import API from '../services/api';

const Files = () => {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchFiles();
  }, []);

  const fetchFiles = async () => {
    try {
      const { data } = await API.get('/files');
      setFiles(data);
    } catch (err) {
      setError('Failed to load files');
    }
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