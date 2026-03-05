#!/usr/bin/env node
// ============================================
// Build Script: Generates n8n workflow JSON
// Run: node build-workflow.js
// Output: workflow.json (import into n8n)
// ============================================

const fs = require('fs');
const path = require('path');

// Read Code node source files
const estimateCode = fs.readFileSync(path.join(__dirname, 'src', 'estimate-engine.js'), 'utf8');
const firmQuoteCode = fs.readFileSync(path.join(__dirname, 'src', 'firm-quote-engine.js'), 'utf8');

// ============================================
// n8n Workflow Structure
// ============================================
const workflow = {
  "name": "Solar Estimate & Lead Qualifier",
  "nodes": [
    // ---- PATH A: Ballpark Estimate ----
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "solar-estimate",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000001",
      "name": "POST /solar-estimate",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [260, 300],
      "webhookId": "solar-estimate-wh"
    },
    {
      "parameters": {
        "jsCode": estimateCode
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000002",
      "name": "Estimate Engine",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [520, 300]
    },
    {
      "parameters": {
        "options": {}
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000003",
      "name": "Send Estimate Response",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [780, 300]
    },

    // ---- PATH B: Firm Quote + Lead ----
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "solar-firm-quote",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000004",
      "name": "POST /solar-firm-quote",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [260, 620],
      "webhookId": "solar-firm-quote-wh"
    },
    {
      "parameters": {
        "jsCode": firmQuoteCode
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000005",
      "name": "Firm Quote Engine",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [520, 620]
    },
    {
      "parameters": {
        "options": {}
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000006",
      "name": "Send Quote Response",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [780, 620]
    },

    // ---- STICKY NOTES ----
    {
      "parameters": {
        "content": "## Solar Estimate & Lead Qualifier\n\n**Two endpoints, zero API keys needed:**\n\n`POST /webhook/solar-estimate` - Ballpark estimate from user inputs\n`POST /webhook/solar-firm-quote` - Bill upload + high-intent lead\n\n**To customise pricing & sizing:**\nEdit the `CONFIG` object at the top of each Code node.\n\n**To add email notifications:**\nAdd a Send Email node after Firm Quote Engine,\nuse `{{ $json._sales_email_html }}` for the body."
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000010",
      "name": "Sticky Note",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [60, 60],
      "parameters": {
        "width": 480,
        "height": 320,
        "content": "## Solar Estimate & Lead Qualifier\n\n**Two endpoints, zero API keys needed:**\n\n`POST /webhook/solar-estimate` - Ballpark estimate\n`POST /webhook/solar-firm-quote` - Bill upload + lead\n\n---\n\n**To customise pricing & sizing:**\nEdit the `CONFIG` object at the top of each Code node.\n\n**To add email notifications:**\nAdd a Send Email node after Firm Quote Engine, use `{{ $json._sales_email_html }}` for body."
      }
    },
    {
      "parameters": {
        "width": 360,
        "height": 140,
        "content": "### Email Integration (optional)\nConnect a **Send Email** node here.\n- To: `{{ $json._sales_email_to }}`\n- Subject: `{{ $json._sales_email_subject }}`\n- HTML Body: `{{ $json._sales_email_html }}`"
      },
      "id": "e1a1b1c1-0001-4000-8000-000000000011",
      "name": "Sticky Note1",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [520, 820]
    }
  ],
  "connections": {
    "POST /solar-estimate": {
      "main": [
        [
          {
            "node": "Estimate Engine",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Estimate Engine": {
      "main": [
        [
          {
            "node": "Send Estimate Response",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "POST /solar-firm-quote": {
      "main": [
        [
          {
            "node": "Firm Quote Engine",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Firm Quote Engine": {
      "main": [
        [
          {
            "node": "Send Quote Response",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  },
  "pinData": {},
  "tags": []
};

// Write output
const outPath = path.join(__dirname, 'workflow.json');
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2));
console.log('Created: ' + outPath);
console.log('');
console.log('Next steps:');
console.log('  1. Open your n8n instance');
console.log('  2. Click "Add workflow" -> "Import from file"');
console.log('  3. Select workflow.json');
console.log('  4. Activate the workflow');
console.log('  5. Test with: curl -X POST https://your-n8n.app.n8n.cloud/webhook/solar-estimate \\');
console.log('       -H "Content-Type: application/json" \\');
console.log('       -d \'{"full_name":"Test User","email":"test@example.com","bill_monthly_aud":350,"goal":"solar_plus_battery"}\'');
