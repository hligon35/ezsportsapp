const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const DatabaseManager = require('../database/DatabaseManager');
const TrackingWorkflowService = require('../services/TrackingWorkflowService');
const WorkflowAutomationService = require('../services/WorkflowAutomationService');

const db = new DatabaseManager();
const workflows = new TrackingWorkflowService();
const automation = new WorkflowAutomationService();

router.get('/admin/events', requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit || 50)));
    const rows = await db.find('workflow_events');
    const items = (Array.isArray(rows) ? rows : [])
      .sort((a, b) => Date.parse(b?.occurredAt || b?.createdAt || 0) - Date.parse(a?.occurredAt || a?.createdAt || 0))
      .slice(0, limit);
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/admin/sends', requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(250, Number(req.query.limit || 50)));
    const rows = await db.find('workflow_sends');
    const items = (Array.isArray(rows) ? rows : [])
      .sort((a, b) => Date.parse(b?.occurredAt || b?.createdAt || 0) - Date.parse(a?.occurredAt || a?.createdAt || 0))
      .slice(0, limit);
    res.json(items);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/admin/sends', requireAdmin, async (req, res) => {
  try {
    const saved = await workflows.recordSend(req.body || {});
    res.status(201).json(saved);
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

router.post('/admin/process', requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(250, Number(req.body?.limit || req.query.limit || 25)));
    const result = await automation.processPending({ limit });
    res.json({ ok: true, result });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

module.exports = router;