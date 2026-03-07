const fs = require('fs');
const path = require('path');
const WorkflowAutomationService = require('../server/services/WorkflowAutomationService');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writePreview(dir, name, payload) {
  if (payload.html) fs.writeFileSync(path.join(dir, `${name}.html`), payload.html, 'utf8');
  if (payload.text) fs.writeFileSync(path.join(dir, `${name}.txt`), payload.text, 'utf8');
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(payload.sampleData || {}, null, 2), 'utf8');
}

function main() {
  const svc = new WorkflowAutomationService();
  const outputDir = path.join(__dirname, '..', 'test-results', 'email-previews', 'workflow-lifecycle');
  ensureDir(outputDir);

  const subscribeEvent = {
    email: 'review-subscriber@example.com',
    path: '/support.html',
    referrer: 'https://google.com/search?q=baseball+netting',
    meta: {
      meta: {
        name: 'Review Subscriber',
        captureType: 'subscribe_form'
      }
    }
  };
  const contactEvent = {
    email: 'review-contact@example.com',
    meta: {
      lead: {
        topic: 'Batting cage quote',
        submissionType: 'contact_form',
        quoteType: 'contact',
        estimatedValue: 0
      },
      meta: {
        name: 'Review Contact',
        message: 'I need pricing for a 55 ft batting cage with installation guidance.'
      }
    }
  };
  const facilityEvent = {
    email: 'review-facility@example.com',
    meta: {
      lead: {
        topic: 'training-facility-design',
        submissionType: 'facility_configurator',
        quoteType: 'training_facility',
        estimatedValue: 18500
      },
      meta: {
        name: 'Review Facility Lead'
      }
    }
  };
  const checkoutEvent = {
    email: 'review-checkout@example.com',
    meta: {
      ecommerce: {
        value: 1249.95,
        items: [
          { productName: 'Batting Cage Net', quantity: 1, price: 999.95 },
          { productName: 'L-Screen', quantity: 1, price: 250.00 }
        ]
      }
    }
  };

  const previews = [
    {
      name: 'subscriber-welcome',
      payload: {
        ...svc.buildEmailCaptureWelcomeEmail(subscribeEvent),
        sampleData: subscribeEvent
      }
    },
    {
      name: 'subscriber-internal',
      payload: {
        ...svc.buildEmailCaptureInternalEmail(subscribeEvent),
        sampleData: subscribeEvent
      }
    },
    {
      name: 'contact-ack',
      payload: {
        ...svc.buildQuoteSubmitAckEmail(contactEvent),
        sampleData: contactEvent
      }
    },
    {
      name: 'facility-ack',
      payload: {
        ...svc.buildQuoteSubmitAckEmail(facilityEvent),
        sampleData: facilityEvent
      }
    },
    {
      name: 'checkout-abandon',
      payload: {
        ...svc.buildCheckoutAbandonEmail(checkoutEvent, 2 * 60 * 60 * 1000),
        sampleData: checkoutEvent
      }
    }
  ];

  previews.forEach(preview => writePreview(outputDir, preview.name, preview.payload));
  console.log(`Wrote workflow template previews to ${outputDir}`);
}

main();