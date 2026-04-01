import React, { useState, useEffect } from 'react';
import {
  Container, Row, Col, Card, Table, Button, Modal, Form,
  Badge, Alert, Spinner
} from 'react-bootstrap';
import {
  FaPlus, FaEdit, FaTrash, FaUser, FaCheck, FaSave
} from 'react-icons/fa';
import API from '../services/api';

const CAMPAIGN_COLORS = {
  'FE': 'primary',
  'SSDI': 'success',
  'ACA CPL Scrub': 'danger',
  'ACA CPL': 'warning',
  'Medicare': 'info',
};

const emptyForm = { publisherName: '', allowedCampaigns: [] };

export default function Admin() {
  const [publishers, setPublishers] = useState([]);
  const [availableCampaigns, setAvailableCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    fetchPublishers();
  }, []);

  const fetchPublishers = async () => {
    try {
      setLoading(true);
      const { data } = await API.get('/admin/publishers');
      setPublishers(data.publishers || []);
      setAvailableCampaigns(data.availableCampaigns || []);
    } catch (err) {
      setError('Failed to load publishers');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditId(null);
    setForm(emptyForm);
    setError('');
    setShowModal(true);
  };

  const openEdit = (pub) => {
    setEditId(pub._id);
    setForm({ publisherName: pub.publisherName, allowedCampaigns: [...pub.allowedCampaigns] });
    setError('');
    setShowModal(true);
  };

  const toggleCampaign = (campaign) => {
    setForm(prev => ({
      ...prev,
      allowedCampaigns: prev.allowedCampaigns.includes(campaign)
        ? prev.allowedCampaigns.filter(c => c !== campaign)
        : [...prev.allowedCampaigns, campaign]
    }));
  };

  const handleSave = async () => {
    if (!form.publisherName.trim()) {
      setError('Publisher name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await API.put(`/admin/publishers/${editId}`, form);
        setSuccess('Publisher updated successfully');
      } else {
        await API.post('/admin/publishers', form);
        setSuccess('Publisher created successfully');
      }
      setShowModal(false);
      fetchPublishers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await API.delete(`/admin/publishers/${id}`);
      setDeleteConfirm(null);
      setSuccess('Publisher deleted');
      fetchPublishers();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Delete failed');
    }
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <Container className="mt-4">
      <Row className="mb-4 align-items-center">
        <Col>
          <h2 className="fw-bold mb-0">⚙️ Admin — Publisher Management</h2>
          <p className="text-muted mt-1 mb-0">Create and manage publishers with campaign permissions</p>
        </Col>
        <Col xs="auto">
          <Button variant="primary" onClick={openCreate}>
            <FaPlus className="me-2" />New Publisher
          </Button>
        </Col>
      </Row>

      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}
      {error && !showModal && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      <Card className="shadow-sm">
        <Card.Header className="bg-dark text-white d-flex align-items-center">
          <FaUser className="me-2" />
          <strong>Publishers ({publishers.length})</strong>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="primary" />
              <p className="mt-2 text-muted">Loading publishers...</p>
            </div>
          ) : publishers.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <FaUser size={40} className="mb-3 opacity-25" />
              <p>No publishers yet. Click <strong>New Publisher</strong> to add one.</p>
            </div>
          ) : (
            <Table hover responsive className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>Publisher Name</th>
                  <th>Allowed Campaigns</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {publishers.map((pub, idx) => (
                  <tr key={pub._id}>
                    <td className="text-muted">{idx + 1}</td>
                    <td>
                      <strong>{pub.publisherName}</strong>
                    </td>
                    <td>
                      <div className="d-flex flex-wrap gap-1">
                        {pub.allowedCampaigns.length === 0 ? (
                          <span className="text-muted fst-italic">None</span>
                        ) : (
                          pub.allowedCampaigns.map(c => (
                            <Badge key={c} bg={CAMPAIGN_COLORS[c] || 'secondary'} className="px-2 py-1">
                              {c}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="text-muted small">{fmtDate(pub.createdAt)}</td>
                    <td className="text-muted small">{fmtDate(pub.updatedAt)}</td>
                    <td className="text-end">
                      <Button
                        variant="outline-primary"
                        size="sm"
                        className="me-2"
                        onClick={() => openEdit(pub)}
                      >
                        <FaEdit />
                      </Button>
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => setDeleteConfirm(pub)}
                      >
                        <FaTrash />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* ─── Create / Edit Modal ─────────────────────────────── */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered size="lg">
        <Modal.Header closeButton className="bg-dark text-white">
          <Modal.Title>
            {editId ? '✏️ Edit Publisher' : '➕ New Publisher'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <Form.Group className="mb-4">
            <Form.Label className="fw-semibold">Publisher Name *</Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g. ABC Leads"
              value={form.publisherName}
              onChange={e => setForm(prev => ({ ...prev, publisherName: e.target.value }))}
              size="lg"
            />
          </Form.Group>

          <Form.Group>
            <Form.Label className="fw-semibold mb-3">
              Allowed Campaigns
              <span className="text-muted fw-normal ms-2 small">
                ({form.allowedCampaigns.length} selected)
              </span>
            </Form.Label>
            <div className="d-flex flex-wrap gap-3">
              {availableCampaigns.map(campaign => {
                const checked = form.allowedCampaigns.includes(campaign);
                return (
                  <div
                    key={campaign}
                    onClick={() => toggleCampaign(campaign)}
                    className={`campaign-checkbox border rounded-3 px-4 py-3 cursor-pointer d-flex align-items-center gap-2 ${
                      checked ? 'border-primary bg-primary bg-opacity-10' : 'border-secondary'
                    }`}
                    style={{ cursor: 'pointer', minWidth: '140px', userSelect: 'none' }}
                  >
                    <div
                      className={`rounded border d-flex align-items-center justify-content-center ${
                        checked ? 'bg-primary border-primary' : 'bg-white border-secondary'
                      }`}
                      style={{ width: 20, height: 20, flexShrink: 0 }}
                    >
                      {checked && <FaCheck color="white" size={10} />}
                    </div>
                    <span className={`fw-semibold ${checked ? 'text-primary' : ''}`}>
                      {campaign}
                    </span>
                  </div>
                );
              })}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" className="me-2" /> : <FaSave className="me-2" />}
            {editId ? 'Update Publisher' : 'Create Publisher'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ─── Delete Confirm Modal ─────────────────────────────── */}
      <Modal show={!!deleteConfirm} onHide={() => setDeleteConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>🗑️ Delete Publisher</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Are you sure you want to delete <strong>{deleteConfirm?.publisherName}</strong>?
          <p className="text-danger mt-2 mb-0 small">This action cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setDeleteConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => handleDelete(deleteConfirm._id)}>
            <FaTrash className="me-2" />Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
