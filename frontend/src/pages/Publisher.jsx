import React, { useState, useEffect, useRef } from 'react';
import {
  Container, Row, Col, Card, Form, Button, Alert,
  Spinner, ProgressBar, Badge, Table
} from 'react-bootstrap';
import {
  FaSearch, FaUpload, FaDownload, FaCheckCircle,
  FaTimesCircle, FaChartBar, FaFileAlt
} from 'react-icons/fa';
import { io } from 'socket.io-client';
import API from '../services/api';

const STATUS_COLORS = {
  DNC: 'danger',
  Duplicate: 'warning',
  'Not Duplicate': 'success',
  'Invalid Number': 'secondary',
};

const STEPS = { VERIFY: 1, SELECT: 2, UPLOAD: 3, PROCESSING: 4, DONE: 5 };

export default function Publisher() {
  // ─── Publisher verification ─────────────────────────────────
  const [step, setStep] = useState(STEPS.VERIFY);
  const [publisherName, setPublisherName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [allowedCampaigns, setAllowedCampaigns] = useState([]);
  const [verifiedName, setVerifiedName] = useState('');

  // ─── Campaign + file ────────────────────────────────────────
  const [campaign, setCampaign] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  // ─── Job tracking ────────────────────────────────────────────
  const [jobId, setJobId] = useState(null);
  const [jobStats, setJobStats] = useState(null);
  const [progress, setProgress] = useState(0);
  const [processingError, setProcessingError] = useState('');
  const [downloadPath, setDownloadPath] = useState(null);

  const socketRef = useRef(null);
  const fileInputRef = useRef(null);

  // ─── Socket.IO setup ─────────────────────────────────────────
  useEffect(() => {
    const socket = io(window.location.origin, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('scrub:progress', (data) => {
      if (data.event === 'started') {
        setJobStats(s => ({ ...s, totalRows: data.totalRows }));
      } else if (data.event === 'progress') {
        setJobStats(data);
        setProgress(data.completionPercent || 0);
      } else if (data.event === 'completed') {
        setJobStats(data);
        setProgress(100);
        setDownloadPath(data.downloadFilePath);
        setStep(STEPS.DONE);
      } else if (data.event === 'failed') {
        setProcessingError(data.error || 'Processing failed');
        setStep(STEPS.PROCESSING);
      }
    });

    return () => socket.disconnect();
  }, []);

  // ─── Verify publisher ────────────────────────────────────────
  const handleVerify = async () => {
    if (!publisherName.trim()) {
      setVerifyError('Please enter your publisher name');
      return;
    }
    setVerifying(true);
    setVerifyError('');
    try {
      const { data } = await API.post('/publisher/verify', { publisherName });
      setVerifiedName(data.publisherName);
      setAllowedCampaigns(data.allowedCampaigns || []);
      setStep(STEPS.SELECT);
    } catch (err) {
      setVerifyError(err.response?.data?.error || 'Publisher not found. Contact your administrator.');
    } finally {
      setVerifying(false);
    }
  };

  // ─── Upload + start processing ───────────────────────────────
  const handleUpload = async () => {
    if (!campaign) {
      setUploadError('Please select a campaign');
      return;
    }
    if (!file) {
      setUploadError('Please select a file');
      return;
    }
    setUploading(true);
    setUploadError('');
    setProcessingError('');

    try {
      const formData = new FormData();
      formData.append('publisherName', verifiedName);
      formData.append('campaign', campaign);
      formData.append('file', file);

      const { data } = await API.post('/publisher/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const jid = data.jobId;
      setJobId(jid);
      setStep(STEPS.PROCESSING);

      // Join Socket.IO room for this job
      if (socketRef.current) {
        socketRef.current.emit('join:job', jid);
      }

      // Also poll in case socket misses events
      pollJobStatus(jid);
    } catch (err) {
      setUploadError(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const pollJobStatus = (jid) => {
    const interval = setInterval(async () => {
      try {
        const { data } = await API.get(`/publisher/job/${jid}`);
        if (data.status === 'completed') {
          clearInterval(interval);
          setJobStats(data);
          setProgress(100);
          setDownloadPath(data.downloadFilePath);
          setStep(STEPS.DONE);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          setProcessingError(data.errorMessage || 'Processing failed');
        } else if (data.status === 'processing') {
          setJobStats(data);
          if (data.totalRows > 0) {
            setProgress(Math.round((data.processedRows / data.totalRows) * 100));
          }
        }
      } catch (e) { /* silent */ }
    }, 3000);

    // Stop polling after 10 minutes
    setTimeout(() => clearInterval(interval), 10 * 60 * 1000);
  };

  const handleDownload = () => {
    if (jobId) {
      window.location.href = `/api/publisher/job/${jobId}/download`;
    }
  };

  const handleReset = () => {
    setStep(STEPS.VERIFY);
    setPublisherName('');
    setVerifiedName('');
    setAllowedCampaigns([]);
    setCampaign('');
    setFile(null);
    setJobId(null);
    setJobStats(null);
    setProgress(0);
    setDownloadPath(null);
    setVerifyError('');
    setUploadError('');
    setProcessingError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (socketRef.current && jobId) {
      socketRef.current.emit('leave:job', jobId);
    }
  };

  const fmtNum = (n) => (n || 0).toLocaleString();

  return (
    <Container className="mt-4" style={{ maxWidth: 760 }}>
      <div className="mb-4">
        <h2 className="fw-bold mb-0">📤 Publisher Scrub Portal</h2>
        <p className="text-muted mt-1 mb-0">Upload your list and scrub it against campaign data</p>
      </div>

      {/* ─── Step Indicator ──────────────────────────────────── */}
      <div className="d-flex align-items-center mb-4 gap-2">
        {[
          { n: 1, label: 'Verify' },
          { n: 2, label: 'Campaign' },
          { n: 3, label: 'Upload' },
          { n: 4, label: 'Processing' },
          { n: 5, label: 'Done' },
        ].map(({ n, label }, i, arr) => (
          <React.Fragment key={n}>
            <div className="d-flex flex-column align-items-center">
              <div
                className={`rounded-circle d-flex align-items-center justify-content-center fw-bold
                  ${step > n ? 'bg-success text-white' : step === n ? 'bg-primary text-white' : 'bg-light text-muted border'}`}
                style={{ width: 36, height: 36, fontSize: 14 }}
              >
                {step > n ? '✓' : n}
              </div>
              <small className={`mt-1 ${step === n ? 'text-primary fw-semibold' : 'text-muted'}`}>
                {label}
              </small>
            </div>
            {i < arr.length - 1 && (
              <div
                className={`flex-grow-1 mt-0`}
                style={{
                  height: 2,
                  background: step > n ? '#198754' : '#dee2e6',
                  marginBottom: 20,
                }}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* ─── STEP 1: Verify Publisher ─────────────────────────── */}
      {step === STEPS.VERIFY && (
        <Card className="shadow-sm">
          <Card.Header className="bg-primary text-white fw-bold">
            Step 1 — Verify Your Publisher Name
          </Card.Header>
          <Card.Body className="p-4">
            {verifyError && <Alert variant="danger">{verifyError}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold">Publisher Name</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter your exact publisher name"
                value={publisherName}
                onChange={e => setPublisherName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleVerify()}
                size="lg"
              />
              <Form.Text className="text-muted">
                Enter the name exactly as registered with your administrator.
              </Form.Text>
            </Form.Group>
            <Button variant="primary" size="lg" onClick={handleVerify} disabled={verifying} className="w-100">
              {verifying ? <><Spinner size="sm" className="me-2" />Verifying...</> : <><FaSearch className="me-2" />Verify Publisher</>}
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* ─── STEP 2: Select Campaign ─────────────────────────── */}
      {step === STEPS.SELECT && (
        <Card className="shadow-sm">
          <Card.Header className="bg-primary text-white fw-bold d-flex justify-content-between">
            <span>Step 2 — Select Campaign</span>
            <Badge bg="light" text="dark">{verifiedName}</Badge>
          </Card.Header>
          <Card.Body className="p-4">
            <Alert variant="success" className="mb-3">
              <FaCheckCircle className="me-2" />
              Publisher verified: <strong>{verifiedName}</strong>
            </Alert>

            <Form.Group className="mb-4">
              <Form.Label className="fw-semibold">Available Campaigns</Form.Label>
              {allowedCampaigns.length === 0 ? (
                <Alert variant="warning">No campaigns assigned. Contact your administrator.</Alert>
              ) : (
                <Form.Select
                  size="lg"
                  value={campaign}
                  onChange={e => setCampaign(e.target.value)}
                >
                  <option value="">— Select a campaign —</option>
                  {allowedCampaigns.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Form.Select>
              )}
            </Form.Group>

            <div className="d-flex gap-2">
              <Button variant="outline-secondary" onClick={handleReset}>Back</Button>
              <Button
                variant="primary"
                className="flex-grow-1"
                onClick={() => { if (campaign) setStep(STEPS.UPLOAD); }}
                disabled={!campaign}
              >
                Continue →
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ─── STEP 3: Upload File ─────────────────────────────── */}
      {step === STEPS.UPLOAD && (
        <Card className="shadow-sm">
          <Card.Header className="bg-primary text-white fw-bold d-flex justify-content-between">
            <span>Step 3 — Upload Your File</span>
            <Badge bg="light" text="dark">{campaign}</Badge>
          </Card.Header>
          <Card.Body className="p-4">
            {uploadError && <Alert variant="danger">{uploadError}</Alert>}

            <div className="mb-3 d-flex gap-2 flex-wrap">
              <Badge bg="info">{verifiedName}</Badge>
              <Badge bg="primary">{campaign}</Badge>
            </div>

            <Form.Group className="mb-4">
              <Form.Label className="fw-semibold">Select File</Form.Label>
              <Form.Control
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                size="lg"
                onChange={e => setFile(e.target.files[0] || null)}
              />
              <Form.Text className="text-muted">
                Supported: CSV, XLSX, XLS. Max 500MB. System will auto-detect the phone number column.
              </Form.Text>
            </Form.Group>

            {file && (
              <Alert variant="light" className="border mb-4">
                <FaFileAlt className="me-2 text-primary" />
                <strong>{file.name}</strong>
                <span className="text-muted ms-2">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
              </Alert>
            )}

            <div className="d-flex gap-2">
              <Button variant="outline-secondary" onClick={() => setStep(STEPS.SELECT)}>Back</Button>
              <Button
                variant="success"
                className="flex-grow-1"
                onClick={handleUpload}
                disabled={uploading || !file}
              >
                {uploading
                  ? <><Spinner size="sm" className="me-2" />Uploading...</>
                  : <><FaUpload className="me-2" />Upload & Start Scrub</>}
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ─── STEP 4: Processing ──────────────────────────────── */}
      {step === STEPS.PROCESSING && (
        <Card className="shadow-sm">
          <Card.Header className="bg-warning fw-bold">
            ⚙️ Processing...
          </Card.Header>
          <Card.Body className="p-4">
            {processingError ? (
              <Alert variant="danger">
                <FaTimesCircle className="me-2" />
                {processingError}
              </Alert>
            ) : (
              <>
                <div className="text-center mb-4">
                  <Spinner animation="border" variant="warning" style={{ width: 48, height: 48 }} />
                  <p className="mt-3 fw-semibold">Scrubbing your list against {campaign}...</p>
                  <p className="text-muted small">Please keep this page open. You will be notified when complete.</p>
                </div>

                <ProgressBar
                  animated
                  now={progress}
                  label={`${progress}%`}
                  variant="warning"
                  className="mb-4"
                  style={{ height: 24 }}
                />

                {jobStats && (
                  <Row className="g-3 text-center">
                    {[
                      { label: 'Total Rows', value: fmtNum(jobStats.totalRows), color: 'secondary' },
                      { label: 'Processed', value: fmtNum(jobStats.processedRows), color: 'primary' },
                      { label: 'Not Duplicate', value: fmtNum(jobStats.nonDuplicateCount), color: 'success' },
                      { label: 'Duplicate', value: fmtNum(jobStats.duplicateCount), color: 'warning' },
                      { label: 'DNC', value: fmtNum(jobStats.dncCount), color: 'danger' },
                      { label: 'Invalid', value: fmtNum(jobStats.invalidCount), color: 'dark' },
                    ].map(({ label, value, color }) => (
                      <Col xs={6} sm={4} key={label}>
                        <div className={`border rounded-3 p-3 border-${color}`}>
                          <div className={`fs-4 fw-bold text-${color}`}>{value}</div>
                          <div className="text-muted small">{label}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                )}
              </>
            )}
          </Card.Body>
        </Card>
      )}

      {/* ─── STEP 5: Done ────────────────────────────────────── */}
      {step === STEPS.DONE && (
        <Card className="shadow-sm border-success">
          <Card.Header className="bg-success text-white fw-bold">
            <FaCheckCircle className="me-2" />✅ Scrub Complete!
          </Card.Header>
          <Card.Body className="p-4">
            <div className="text-center mb-4">
              <FaCheckCircle size={56} className="text-success mb-3" />
              <h5 className="fw-bold">Your file has been processed</h5>
              <p className="text-muted">Campaign: <strong>{campaign}</strong> — Publisher: <strong>{verifiedName}</strong></p>
            </div>

            {jobStats && (
              <>
                <h6 className="fw-semibold mb-3">📊 Results Summary</h6>
                <Row className="g-3 text-center mb-4">
                  {[
                    { label: 'Total Rows', value: fmtNum(jobStats.totalRows), color: 'secondary' },
                    { label: 'Not Duplicate', value: fmtNum(jobStats.nonDuplicateCount), color: 'success' },
                    { label: 'Duplicate', value: fmtNum(jobStats.duplicateCount), color: 'warning' },
                    { label: 'DNC', value: fmtNum(jobStats.dncCount), color: 'danger' },
                    { label: 'Invalid', value: fmtNum(jobStats.invalidCount), color: 'dark' },
                  ].map(({ label, value, color }) => (
                    <Col xs={6} sm={4} key={label}>
                      <div className={`border rounded-3 p-3 border-${color}`}>
                        <div className={`fs-3 fw-bold text-${color}`}>{value}</div>
                        <div className="text-muted small">{label}</div>
                      </div>
                    </Col>
                  ))}
                </Row>
              </>
            )}

            <div className="d-grid gap-2">
              <Button variant="success" size="lg" onClick={handleDownload}>
                <FaDownload className="me-2" />Download Scrubbed File (CSV)
              </Button>
              <Button variant="outline-secondary" onClick={handleReset}>
                Process Another File
              </Button>
            </div>

            <div className="mt-3 p-3 bg-light rounded small text-muted">
              <strong>Output file contains all original columns + </strong>
              <code>scrub_status</code> column with values:
              {' '}
              {Object.keys(STATUS_COLORS).map(s => (
                <Badge key={s} bg={STATUS_COLORS[s]} className="me-1">{s}</Badge>
              ))}
            </div>
          </Card.Body>
        </Card>
      )}
    </Container>
  );
}
