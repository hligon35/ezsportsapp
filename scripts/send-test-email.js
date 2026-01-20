// Quick end-to-end test for EmailService
require('dotenv').config({ path: require('path').join(__dirname, '..', 'server', '.env') });
const EmailService = require('../server/services/EmailService');

(async function main(){
  const svc = new EmailService();
  process.env.EMAIL_DEBUG = 'true';
  const to = process.argv[2] || process.env.CONTACT_INBOX || 'info@ezsportsnetting.com';
  console.log('Sending test email to:', to);
  const out = await svc.queue({ to, subject: 'Test email from scripts/send-test-email.js', html: '<p>This is a test.</p>', text: 'This is a test.' });
  console.log('Result:', out);
})();
