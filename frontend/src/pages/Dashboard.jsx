import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Table, Badge } from 'react-bootstrap';
import { FaCalendarAlt, FaClock, FaDatabase, FaFileAlt } from 'react-icons/fa';
import API from '../services/api';

const Dashboard = () => {
  const [dashboard, setDashboard] = useState({ job: {}, files: [] });

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchDashboard = async () => {
    try {
      const { data } = await API.get('/dashboard');
      setDashboard(data);
    } catch (err) {
      console.error(err);
    }
  };

  const job = dashboard.job || {};
  const files = dashboard.files || [];

  const fmtDateTime = (d) => {
    if (!d) return 'N/A';
    try {
      return new Date(d).toLocaleString(undefined, job.timezone ? { timeZone: job.timezone } : undefined);
    } catch {
      return new Date(d).toLocaleString();
    }
  };

  const getStatusBadge = (status) => {
    switch(status) {
      case 'Success': return <Badge bg="success" className="px-3 py-2"> Success</Badge>;
      case 'Failed': return <Badge bg="danger" className="px-3 py-2">Failed</Badge>;
      case 'Running': return <Badge bg="warning" className="px-3 py-2"> Running</Badge>;
      default: return <Badge bg="secondary" className="px-3 py-2">Idle</Badge>;
    }
  };

  return (
    <Container className="mt-5">
      <h2 className="mb-4 fw-bold">📊 Dashboard</h2>
      <Row>
        <Col lg={6} className="mb-4">
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex align-items-center mb-3">
                <FaCalendarAlt size={24} className="text-primary me-2" />
                <Card.Title className="mb-0">Last Job Status</Card.Title>
              </div>
              <Row>
                <Col sm={6}>
                  <p className="mb-2"><strong>Next Run:</strong> {job.runTime ? fmtDateTime(job.runTime) : 'N/A'}</p>
                  <p className="mb-2"><strong>Timezone:</strong> {job.timezone || 'N/A'}</p>
                  <p className="mb-2"><strong>Last Run:</strong> {job.lastRunAt ? fmtDateTime(job.lastRunAt) : 'Never'}</p>
                  <p className="mb-0"><strong>Status:</strong> {getStatusBadge(job.lastRunStatus)}</p>
                </Col>
                <Col sm={6}>
                  <p className="mb-2"><strong>Total Fetched:</strong> <span className="fw-bold text-primary">{job.totalFetched || 0}</span></p>
                  <p className="mb-2"><strong>After Dedup:</strong> <span className="fw-bold text-success">{job.totalUniqueAfterDedup || 0}</span></p>
                  <p className="mb-0"><strong>Saved:</strong> <span className="fw-bold text-info">{job.totalSaved || 0}</span></p>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={6} className="mb-4">
          <Card className="h-100">
            <Card.Body>
              <div className="d-flex align-items-center mb-3">
                <FaFileAlt size={24} className="text-success me-2" />
                <Card.Title className="mb-0">Recent Files</Card.Title>
              </div>
              {files.length === 0 ? (
                <p className="text-muted">No files generated yet.</p>
              ) : (
                <Table hover size="sm" className="mb-0">
                  <thead>
                    <tr>
                      <th>File Name</th>
                      <th>Campaign</th>
                      <th className="text-center">Numbers</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.slice(0, 5).map(file => (
                      <tr key={file._id}>
                        <td className="text-truncate" style={{ maxWidth: '150px' }}>{file.fileName}</td>
                        <td>{file.campaignName}</td>
                        <td className="text-center fw-bold">{file.totalNumbers}</td>
                        <td>{new Date(file.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {job.perCampaignStats && job.perCampaignStats.length > 0 && (
        <Card className="mt-3">
          <Card.Body>
            <div className="d-flex align-items-center mb-3">
              <FaDatabase size={24} className="text-info me-2" />
              <Card.Title className="mb-0">Per Campaign Statistics</Card.Title>
            </div>
            <Table striped hover responsive>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="text-center">Fetched</th>
                  <th className="text-center">After Dedup</th>
                  <th className="text-center">After DNC</th>
                  <th className="text-center">Saved</th>
                </tr>
              </thead>
              <tbody>
                {job.perCampaignStats.map((stat, idx) => (
                  <tr key={idx}>
                    <td className="fw-bold">{stat.campaignName}</td>
                    <td className="text-center">{stat.fetchedCount}</td>
                    <td className="text-center text-success">{stat.afterDedup}</td>
                    <td className="text-center text-warning">{stat.afterDNC}</td>
                    <td className="text-center text-primary fw-bold">{stat.finalSaved}</td>
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

export default Dashboard;