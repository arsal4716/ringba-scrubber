import React, { useState, useEffect } from 'react';
import {Row ,Col,Container, Form, Button, Card, Toast } from 'react-bootstrap';
import { FaClock, FaGlobe } from 'react-icons/fa';
import API from '../services/api';

const Schedule = () => {
  const [runTime, setRunTime] = useState('09:00');
  const [timezone, setTimezone] = useState('Asia/Karachi');
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  useEffect(() => {
    fetchSchedule();
  }, []);

  const fetchSchedule = async () => {
    try {
      const { data } = await API.get('/schedule');
      if (data.runTime) {
        const tz = data.timezone || 'Asia/Karachi';
        setTimezone(tz);

        const d = new Date(data.runTime);
        // Extract HH:mm in the job timezone (not the browser timezone)
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: tz,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).formatToParts(d);
        const h = parts.find(p => p.type === 'hour')?.value || '09';
        const m = parts.find(p => p.type === 'minute')?.value || '00';
        setRunTime(`${h}:${m}`);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await API.post('/schedule', { runTime, timezone });
      setToastMsg('Schedule updated successfully');
      setShowToast(true);
    } catch (err) {
      setToastMsg('Error updating schedule');
      setShowToast(true);
    }
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-center">
        <Col md={8} lg={6}>
          <Card>
            <Card.Body className="p-4">
              <div className="text-center mb-4">
                <h2 className="fw-bold">Schedule Fetch Job</h2>
                <p className="text-muted">Set the daily run time and timezone</p>
              </div>
              <Form onSubmit={handleSubmit}>
                <Form.Group className="mb-4">
                  <Form.Label className="fw-semibold"><FaClock className="me-2" />Time (24-hour)</Form.Label>
                  <Form.Control 
                    type="time" 
                    value={runTime} 
                    onChange={(e) => setRunTime(e.target.value)} 
                    required 
                    className="py-2"
                  />
                </Form.Group>
                <Form.Group className="mb-4">
                  <Form.Label className="fw-semibold"><FaGlobe className="me-2" />Timezone</Form.Label>
                  <Form.Select 
                    value={timezone} 
                    onChange={(e) => setTimezone(e.target.value)}
                    className="py-2"
                  >
                    <option value="Asia/Karachi">Asia/Karachi (PKT)</option>
                    <option value="America/New_York">America/New_York (EST)</option>
                  </Form.Select>
                </Form.Group>
                <div className="d-grid">
                  <Button variant="primary" type="submit" size="lg">
                    Save Schedule
                  </Button>
                </div>
              </Form>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Toast 
        show={showToast} 
        onClose={() => setShowToast(false)} 
        delay={3000} 
        autohide 
        style={{ position: 'fixed', top: 20, right: 20, minWidth: '250px' }}
        className="border-0"
      >
        <Toast.Body className="text-center py-3">{toastMsg}</Toast.Body>
      </Toast>
    </Container>
  );
};

export default Schedule;