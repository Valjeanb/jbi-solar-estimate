# Solar Estimate & Lead Qualifier - Setup Guide

## Quick Start (5 minutes)

### 1. Generate the workflow JSON
```bash
cd solar-n8n
node build-workflow.js
```
This creates `workflow.json` ready to import.

### 2. Import into n8n
1. Open https://valbmm.app.n8n.cloud/
2. Click **Add workflow** (or the + button)
3. Click the **...** menu > **Import from file**
4. Select `workflow.json`
5. Click **Save**
6. Toggle the workflow to **Active**

### 3. Test with curl

**Ballpark Estimate:**
```bash
curl -X POST https://valbmm.app.n8n.cloud/webhook/solar-estimate \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "Jane Smith",
    "email": "jane@example.com",
    "mobile": "0412345678",
    "address": "123 Solar St, Brisbane QLD 4000",
    "bill_monthly_aud": 350,
    "goal": "solar_plus_battery",
    "phase": "single",
    "has_solar": false,
    "has_battery": false,
    "notes": "Interested in battery for blackout protection"
  }'
```

**Firm Quote (with file upload):**
```bash
curl -X POST https://valbmm.app.n8n.cloud/webhook/solar-firm-quote \
  -F "full_name=Jane Smith" \
  -F "email=jane@example.com" \
  -F "mobile=0412345678" \
  -F "address=123 Solar St, Brisbane QLD 4000" \
  -F "bill_monthly_aud=350" \
  -F "goal=solar_plus_battery" \
  -F "phase=single" \
  -F "has_solar=false" \
  -F "has_battery=false" \
  -F "bill_file=@electricity-bill.pdf"
```

### 4. Demo with the front-end
Open `demo.html` in a browser. The webhook URL is pre-configured for valbmm.app.n8n.cloud.

---

## Endpoints

| Endpoint | Method | Content-Type | Purpose |
|----------|--------|-------------|---------|
| `/webhook/solar-estimate` | POST | application/json | Ballpark estimate |
| `/webhook/solar-firm-quote` | POST | multipart/form-data | Firm quote + lead |

### Test URLs (while editing in n8n)
Use `/webhook-test/solar-estimate` and `/webhook-test/solar-firm-quote` for testing before activating.

---

## Input Fields

| Field | Type | Required (Estimate) | Required (Firm Quote) |
|-------|------|--------------------|-----------------------|
| full_name | string | Yes | Yes |
| email | string | Yes | Yes |
| mobile | string | No | No |
| address | string | No | **Yes** |
| bill_monthly_aud | number | Yes | Yes |
| goal | enum | No (default: solar_plus_battery) | No |
| phase | enum | No (default: single) | No |
| has_solar | boolean | No | No |
| solar_kw | number | No (if has_solar) | No |
| has_battery | boolean | No | No |
| battery_kwh | number | No (if has_battery) | No |
| notes | string | No | No |
| bill_file | file | N/A | Optional (PDF/JPG/PNG, max 10MB) |

**Goal values:** `solar_only`, `battery_only`, `solar_plus_battery`
**Phase values:** `single`, `two`, `three`

**Honeypot fields** (for spam protection): `website`, `_gotcha`, `honeypot` - if any contain a value, the request is rejected.

---

## Customising the Estimation Config

Open either Code node in n8n and edit the `CONFIG` object at the top:

```javascript
const CONFIG = {
  electricity_rate_aud_per_kwh: 0.30,   // Change for your market
  solar: {
    kwh_per_kw_per_day: 4.0,            // Adjust for location (3.5-5.0 in AU)
    sizes_kw: [3.3, 5, 6.6, 8, 10, 13.2, 15, 20],
    price_per_kw_min: 900,              // Your pricing
    price_per_kw_max: 1300,
  },
  battery: {
    sizes_kwh: [5, 10, 13.5, 15, 20],
    price_per_kwh_min: 800,
    price_per_kwh_max: 1200,
  },
  // ... etc
};
```

---

## Adding Email Notifications

1. Add a **Send Email** node to the canvas
2. Connect it after **Firm Quote Engine** (in parallel with Send Quote Response)
3. Configure SMTP credentials
4. Set:
   - **To:** `{{ $json._sales_email_to }}`
   - **Subject:** `{{ $json._sales_email_subject }}`
   - **HTML Body:** `{{ $json._sales_email_html }}`

---

## Embedding in a Website

### Option A: iframe
```html
<iframe src="path/to/demo.html" width="100%" height="800" frameborder="0"></iframe>
```

### Option B: Fetch API
```javascript
const response = await fetch('https://valbmm.app.n8n.cloud/webhook/solar-estimate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(formData),
});
const estimate = await response.json();
```

### CORS
n8n cloud webhooks allow cross-origin requests by default. If you hit CORS issues, check the webhook node's **Options** > **Allowed Origins**.

---

## Architecture

```
[Website Form] --POST JSON--> [n8n Webhook]
                                    |
                              [Code Node: Validate + Estimate]
                                    |
                              [Respond to Webhook]
                                    |
                        [JSON Response + HTML Report]
```

No external APIs, databases, or credentials required for the basic estimate flow.
