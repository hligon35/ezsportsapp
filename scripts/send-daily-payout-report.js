const PayoutReportService = require('../server/services/PayoutReportService');

async function main() {
  const svc = new PayoutReportService();
  const out = await svc.sendDailyPayoutReport({ day: process.argv[2] || 'yesterday' });
  console.log(JSON.stringify({
    subject: out.subject,
    start: out.start,
    end: out.end,
    sent: out.sent
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
