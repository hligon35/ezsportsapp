const WorkflowAutomationService = require('../services/WorkflowAutomationService');

function startWorkflowScheduler() {
  const enabled = String(process.env.WORKFLOW_AUTOMATIONS_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const intervalSeconds = Math.max(60, Number(process.env.WORKFLOW_AUTOMATIONS_INTERVAL_SECONDS || 300) || 300);
  const batchSize = Math.max(1, Math.min(100, Number(process.env.WORKFLOW_AUTOMATIONS_BATCH_SIZE || 25) || 25));
  const svc = new WorkflowAutomationService();

  const run = async () => {
    try {
      const result = await svc.processPending({ limit: batchSize });
      if (result.sent || result.queued || result.failed || result.skipped) {
        console.log(`[workflow-automation] scanned=${result.scanned} sent=${result.sent} queued=${result.queued} skipped=${result.skipped} failed=${result.failed} deferred=${result.deferred}`);
      }
    } catch (e) {
      console.warn('[workflow-automation] failed:', e?.message || e);
    } finally {
      setTimeout(run, intervalSeconds * 1000);
    }
  };

  console.log(`[workflow-automation] scheduled every ${intervalSeconds}s with batch size ${batchSize}`);
  setTimeout(run, Math.min(15000, intervalSeconds * 1000));
  return { enabled: true, intervalSeconds, batchSize };
}

module.exports = { startWorkflowScheduler };