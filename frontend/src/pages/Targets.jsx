import React, { useState, useEffect } from 'react';
import {
  Container, Row, Col, Card, Table, Button, Modal, Form,
  Badge, Alert, Spinner
} from 'react-bootstrap';
import {
  FaPlus, FaEdit, FaTrash, FaBullseye, FaSave, FaPlay, FaSync
} from 'react-icons/fa';
import API from '../services/api';

const PRODUCT_COLORS = {
  ACA: 'primary',
  SSDI: 'success',
};

const STATUS_COLORS = {
  Success: 'success',
  Failed: 'danger',
  Skipped: 'secondary',
};

const emptyForm = { name: '', product: 'ACA', ringbaTargetId: '', enabled: true };

export default function Targets() {
  const [targets, setTargets] = useState([]);
  const [products, setProducts] = useState(['ACA', 'SSDI']);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  useEffect(() => {
    fetchTargets();
  }, []);

  const fetchTargets = async () => {
    try {
      setLoading(true);
      const { data } = await API.get('/targets');
      setTargets(data.targets || []);
      if (data.availableProducts?.length) setProducts(data.availableProducts);
    } catch (err) {
      setError('Failed to load targets');
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

  const openEdit = (t) => {
    setEditId(t._id);
    setForm({
      name: t.name,
      product: t.product,
      ringbaTargetId: t.ringbaTargetId,
      enabled: t.enabled !== false,
    });
    setError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return setError('Target name is required');
    if (!form.ringbaTargetId.trim()) return setError('Ringba Target ID is required');
    setSaving(true);
    setError('');
    try {
      if (editId) {
        await API.put(`/targets/${editId}`, form);
        setSuccess('Target updated');
      } else {
        await API.post('/targets', form);
        setSuccess('Target created');
      }
      setShowModal(false);
      fetchTargets();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await API.delete(`/targets/${id}`);
      setDeleteConfirm(null);
      setSuccess('Target deleted');
      fetchTargets();
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Delete failed');
    }
  };

  const handleRunNow = async () => {
    setRunning(true);
    setError('');
    try {
      await API.post('/targets/run');
      setSuccess('Fetch + Ringba upload started. Refresh in a minute to see status.');
      setTimeout(() => setSuccess(''), 6000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start run');
    } finally {
      setRunning(false);
    }
  };

  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : '—');

  return (
    <Container className="mt-4">
      <Row className="mb-4 align-items-center">
        <Col>
          <h2 className="fw-bold mb-0">🎯 Ringba Targets</h2>
          <p className="text-muted mt-1 mb-0">
            Map each product to the Ringba ping-tree target(s) that receive the daily
            suppression Bulk Tag.
          </p>
        </Col>
        <Col xs="auto" className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={fetchTargets} title="Refresh">
            <FaSync />
          </Button>
          <Button variant="success" onClick={handleRunNow} disabled={running}>
            {running ? <Spinner size="sm" className="me-2" /> : <FaPlay className="me-2" />}
            Run Now
          </Button>
          <Button variant="primary" onClick={openCreate}>
            <FaPlus className="me-2" />New Target
          </Button>
        </Col>
      </Row>

      {success && <Alert variant="success" onClose={() => setSuccess('')} dismissible>{success}</Alert>}
      {error && !showModal && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      <Card className="shadow-sm">
        <Card.Header className="bg-dark text-white d-flex align-items-center">
          <FaBullseye className="me-2" />
          <strong>Targets ({targets.length})</strong>
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <Spinner animation="border" variant="primary" />
              <p className="mt-2 text-muted">Loading targets...</p>
            </div>
          ) : targets.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <FaBullseye size={40} className="mb-3 opacity-25" />
              <p>No targets yet. Click <strong>New Target</strong> to add one.</p>
            </div>
          ) : (
            <Table hover responsive className="mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Product</th>
                  <th>Ringba Target ID</th>
                  <th>Enabled</th>
                  <th>Last Run</th>
                  <th>Last Status</th>
                  <th className="text-end">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((t, idx) => (
                  <tr key={t._id}>
                    <td className="text-muted">{idx + 1}</td>
                    <td><strong>{t.name}</strong></td>
                    <td>
                      <Badge bg={PRODUCT_COLORS[t.product] || 'secondary'} className="px-2 py-1">
                        {t.product}
                      </Badge>
                    </td>
                    <td><code className="small">{t.ringbaTargetId}</code></td>
                    <td>
                      {t.enabled
                        ? <Badge bg="success">On</Badge>
                        : <Badge bg="secondary">Off</Badge>}
                    </td>
                    <td className="text-muted small">
                      {fmtDate(t.lastUploadedAt)}
                      {t.lastUploadedCount ? (
                        <div className="text-muted">{t.lastUploadedCount.toLocaleString()} #s</div>
                      ) : null}
                    </td>
                    <td>
                      {t.lastStatus ? (
                        <Badge bg={STATUS_COLORS[t.lastStatus] || 'secondary'} title={t.lastError || ''}>
                          {t.lastStatus}
                        </Badge>
                      ) : <span className="text-muted">—</span>}
                      {t.lastStatus === 'Failed' && t.lastError ? (
                        <div className="text-danger small mt-1" style={{ maxWidth: 220 }}>
                          {t.lastError}
                        </div>
                      ) : null}
                    </td>
                    <td className="text-end">
                      <Button variant="outline-primary" size="sm" className="me-2" onClick={() => openEdit(t)}>
                        <FaEdit />
                      </Button>
                      <Button variant="outline-danger" size="sm" onClick={() => setDeleteConfirm(t)}>
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
          <Modal.Title>{editId ? '✏️ Edit Target' : '➕ New Target'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <Alert variant="danger">{error}</Alert>}

          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Target Name *</Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g. LeadMarket 360-ACA-Xfers-CPL"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              size="lg"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Product *</Form.Label>
            <Form.Select
              value={form.product}
              onChange={(e) => setForm((p) => ({ ...p, product: e.target.value }))}
              size="lg"
            >
              {products.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">
              Which product's number list gets uploaded to this target.
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">Ringba Ping-Tree Target ID *</Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g. PI8fbb6def574644169aa43d066ff7cb7d"
              value={form.ringbaTargetId}
              onChange={(e) => setForm((p) => ({ ...p, ringbaTargetId: e.target.value }))}
            />
            <Form.Text className="text-muted">
              Found in the Ringba ping-tree target URL / API. The Bulk Tag on this
              target's <code>bulkCriteria</code> is replaced each run.
            </Form.Text>
          </Form.Group>

          <Form.Check
            type="switch"
            id="target-enabled"
            label="Enabled (include in daily run)"
            checked={form.enabled}
            onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? <Spinner size="sm" className="me-2" /> : <FaSave className="me-2" />}
            {editId ? 'Update Target' : 'Create Target'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* ─── Delete Confirm Modal ─────────────────────────────── */}
      <Modal show={!!deleteConfirm} onHide={() => setDeleteConfirm(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>🗑️ Delete Target</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          Delete <strong>{deleteConfirm?.name}</strong>?
          <p className="text-danger mt-2 mb-0 small">This action cannot be undone.</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => handleDelete(deleteConfirm._id)}>
            <FaTrash className="me-2" />Delete
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}
