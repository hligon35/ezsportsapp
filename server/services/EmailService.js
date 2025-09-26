const DatabaseManager = require('../database/DatabaseManager');

class EmailService {
  constructor(){ this.db = new DatabaseManager(); }

  // In this demo, we store emails to an outbox instead of sending.
  // Integrate a real provider (SendGrid/Mailgun/SES) later.
  async queue({ to, subject, html, text, tags=[] }){
    const email = await this.db.insert('emails', { to, subject, html, text, tags, status:'queued' });
    return email;
  }

  async list(){ return await this.db.findAll('emails'); }
}

module.exports = EmailService;
