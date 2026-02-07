const fs = require('fs');
const path = require('path');

const PayoutReportService = require('../server/services/PayoutReportService');

async function main() {
  const svc = new PayoutReportService();

  const daily = await svc.buildDailyPayoutReport({ day: 'yesterday' });
  const weekly = await svc.buildWeeklyPayoutReport({ end: new Date() });

  const outDir = path.join(__dirname, '..', 'test-results');
  fs.mkdirSync(outDir, { recursive: true });

  const dailyTxt = path.join(outDir, 'sample-daily-payout-report.txt');
  const dailyHtml = path.join(outDir, 'sample-daily-payout-report.html');
  const weeklyTxt = path.join(outDir, 'sample-weekly-payout-report.txt');
  const weeklyHtml = path.join(outDir, 'sample-weekly-payout-report.html');

  fs.writeFileSync(dailyTxt, daily.text, 'utf8');
  fs.writeFileSync(dailyHtml, daily.html, 'utf8');
  fs.writeFileSync(weeklyTxt, weekly.text, 'utf8');
  fs.writeFileSync(weeklyHtml, weekly.html, 'utf8');

  console.log(JSON.stringify({
    daily: { subject: daily.subject, textFile: path.relative(process.cwd(), dailyTxt), htmlFile: path.relative(process.cwd(), dailyHtml) },
    weekly: { subject: weekly.subject, textFile: path.relative(process.cwd(), weeklyTxt), htmlFile: path.relative(process.cwd(), weeklyHtml) }
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
