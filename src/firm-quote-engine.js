// ============================================
// FIRM QUOTE & LEAD QUALIFIER ENGINE v2.0
// n8n Code Node for POST /solar-firm-quote
// ============================================
// CONFIG must stay in sync with estimate-engine.js

const CONFIG = {
  electricity_rate_aud_per_kwh: 0.30,
  avg_days_per_month: 30.44,
  solar: {
    kwh_per_kw_per_day: 4.0,
    coverage_min: 0.80,
    coverage_max: 1.00,
    sizes_kw: [3.3, 5, 6.6, 8, 10, 13.2, 15, 20],
    tiers: {
      economy: { label: 'Economy', panel_type: 'Budget panels + string inverter', warranty_years: 10, price_per_kw: 900 },
      premium: { label: 'Premium', panel_type: 'Tier-1 panels + microinverter', warranty_years: 25, price_per_kw: 1300 },
    },
  },
  battery: {
    daily_coverage: 0.60,
    sizes_kwh: [5, 10, 13.5, 15, 20],
    dod_factor: 1.25,
    inefficiency_factor: 1.1,
    tiers: {
      economy: { label: 'Economy', battery_type: 'Standard lithium', warranty_years: 10, price_per_kwh: 800 },
      premium: { label: 'Premium', battery_type: 'Premium lithium (Tesla/BYD)', warranty_years: 15, price_per_kwh: 1200 },
    },
    retrofit_premium: 1.15,
  },
  savings: {
    self_consumption_no_battery_min: 0.30,
    self_consumption_no_battery_max: 0.50,
    self_consumption_with_battery_min: 0.70,
    self_consumption_with_battery_max: 0.85,
    feed_in_tariff: 0.05,
  },
  stc: {
    deeming_years: 5,
    stc_price_aud: 40,
    battery_stcs_per_kwh: 8.4,
    zones: {
      1: { rating: 1.622, prefixes: ['08','09'], label: 'Zone 1 (NT/Far North QLD)' },
      2: { rating: 1.536, prefixes: ['40','41','42','43','44','45','46','47','48','49','60','61','62','63','64','65','66','67','68','69'], label: 'Zone 2 (QLD/WA)' },
      3: { rating: 1.382, prefixes: ['10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','50','51','52','53','54','55','56','57','58','59'], label: 'Zone 3 (NSW/VIC/SA)' },
      4: { rating: 1.185, prefixes: ['70','71','72','73','74','75','76','77','78','79'], label: 'Zone 4 (TAS)' },
    },
    default_zone: 3,
  },
  sales_email_to: 'sales@example.com',
  sales_email_subject_prefix: '[Solar Lead]',
};

// ============================================
// INPUT & VALIDATION (stricter for firm quote)
// ============================================
const body = $input.first().json.body || $input.first().json;

if (body.website || body._gotcha || body.honeypot) {
  return [{ json: { success: false, error: 'Invalid submission.' } }];
}

const required = ['full_name', 'email', 'bill_monthly_aud', 'address'];
const missing = required.filter(f => !body[f]);
if (missing.length) {
  return [{ json: { success: false, error: 'Missing required fields: ' + missing.join(', ') } }];
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(body.email)) {
  return [{ json: { success: false, error: 'Invalid email address.' } }];
}

const bill = parseFloat(body.bill_monthly_aud);
if (isNaN(bill) || bill <= 0 || bill > 50000) {
  return [{ json: { success: false, error: 'bill_monthly_aud must be a positive number (max $50,000).' } }];
}

let fileInfo = null;
const binaryData = $input.first().binary;
if (binaryData) {
  const fileKey = Object.keys(binaryData)[0];
  if (fileKey) {
    const file = binaryData[fileKey];
    const fileName = file.fileName || 'unknown';
    const fileSize = file.fileSize || 0;
    const ext = fileName.split('.').pop().toLowerCase();
    if (fileSize > 10 * 1024 * 1024) return [{ json: { success: false, error: 'File too large. Maximum 10MB.' } }];
    if (!['pdf', 'jpg', 'jpeg', 'png'].includes(ext)) return [{ json: { success: false, error: 'Invalid file type. Accepted: PDF, JPG, PNG.' } }];
    fileInfo = { fileName, fileSize, mimeType: file.mimeType, extension: ext };
  }
}

const validGoals = ['solar_only', 'battery_only', 'solar_plus_battery'];
const goal = validGoals.includes(body.goal) ? body.goal : 'solar_plus_battery';
const validPhases = ['single', 'two', 'three'];
const phase = validPhases.includes(body.phase) ? body.phase : 'single';

// ============================================
// ZONE DETECTION
// ============================================
const postcodeMatch = (body.postcode || body.address || '').match(/\b(\d{4})\b/);
const postcodeStr = postcodeMatch ? postcodeMatch[1] : '';
const postcodePrefix = postcodeStr.substring(0, 2);

let detected_zone = CONFIG.stc.default_zone;
let zone_rating = CONFIG.stc.zones[CONFIG.stc.default_zone].rating;
let zone_label = CONFIG.stc.zones[CONFIG.stc.default_zone].label;

for (const [zNum, zData] of Object.entries(CONFIG.stc.zones)) {
  if (zData.prefixes.some(p => postcodePrefix === p)) {
    detected_zone = parseInt(zNum);
    zone_rating = zData.rating;
    zone_label = zData.label;
    break;
  }
}

// ============================================
// ESTIMATION
// ============================================
const monthly_kwh = bill / CONFIG.electricity_rate_aud_per_kwh;
const daily_kwh = monthly_kwh / CONFIG.avg_days_per_month;

const existing_solar_kw = body.has_solar ? (parseFloat(body.solar_kw) || 0) : 0;
const existing_battery_kwh = body.has_battery ? (parseFloat(body.battery_kwh) || 0) : 0;

let rec_solar_kw = 0;
if (goal === 'solar_only' || goal === 'solar_plus_battery') {
  const target = daily_kwh * CONFIG.solar.coverage_max;
  const needed = target / CONFIG.solar.kwh_per_kw_per_day;
  const net = Math.max(needed - existing_solar_kw, 0);
  rec_solar_kw = CONFIG.solar.sizes_kw.find(s => s >= net) || CONFIG.solar.sizes_kw[CONFIG.solar.sizes_kw.length - 1];
}

let rec_battery_kwh = 0;
if (goal === 'battery_only' || goal === 'solar_plus_battery') {
  const target = daily_kwh * CONFIG.battery.daily_coverage;
  const net = Math.max(target - existing_battery_kwh, 0);
  rec_battery_kwh = CONFIG.battery.sizes_kwh.find(s => s >= net) || CONFIG.battery.sizes_kwh[CONFIG.battery.sizes_kwh.length - 1];
}

const phase_multiplier = phase === 'three' ? 1.08 : phase === 'two' ? 1.04 : 1.0;

// STC
const solar_stcs = rec_solar_kw > 0 ? Math.floor(rec_solar_kw * zone_rating * CONFIG.stc.deeming_years) : 0;
const battery_stcs = rec_battery_kwh > 0 ? Math.floor(rec_battery_kwh * CONFIG.stc.battery_stcs_per_kwh) : 0;
const total_stcs = solar_stcs + battery_stcs;
const stc_rebate_aud = total_stcs * CONFIG.stc.stc_price_aud;

// Package tiers
function calcTier(tierName) {
  const st = CONFIG.solar.tiers[tierName];
  const bt = CONFIG.battery.tiers[tierName];
  let solar_cost = rec_solar_kw > 0 ? rec_solar_kw * st.price_per_kw : 0;
  let battery_cost = 0;
  if (rec_battery_kwh > 0) {
    battery_cost = rec_battery_kwh * bt.price_per_kwh;
    if (goal === 'battery_only') battery_cost *= CONFIG.battery.retrofit_premium;
  }
  const gross = Math.round((solar_cost + battery_cost) * phase_multiplier / 100) * 100;
  const net = Math.max(0, gross - stc_rebate_aud);
  return { tier: tierName, label: st.label, panel_type: st.panel_type, battery_type: bt.battery_type, warranty_solar: st.warranty_years, warranty_battery: bt.warranty_years, gross_price_aud: gross, stc_rebate_aud, net_price_aud: net };
}

const economy = calcTier('economy');
const premium = calcTier('premium');

// Savings
const hasBatt = rec_battery_kwh > 0;
const sc_min = hasBatt ? CONFIG.savings.self_consumption_with_battery_min : CONFIG.savings.self_consumption_no_battery_min;
const sc_max = hasBatt ? CONFIG.savings.self_consumption_with_battery_max : CONFIG.savings.self_consumption_no_battery_max;
const total_solar_kw = existing_solar_kw + rec_solar_kw;
const daily_gen = total_solar_kw * CONFIG.solar.kwh_per_kw_per_day;
const annual_gen = daily_gen * 365;
const sav_min = ((annual_gen * sc_min * CONFIG.electricity_rate_aud_per_kwh) + (annual_gen * (1 - sc_max) * CONFIG.savings.feed_in_tariff)) / 12;
const sav_max = ((annual_gen * sc_max * CONFIG.electricity_rate_aud_per_kwh) + (annual_gen * (1 - sc_min) * CONFIG.savings.feed_in_tariff)) / 12;

const packageNames = { solar_only: 'Solar Power Package', battery_only: 'Battery Storage Package', solar_plus_battery: 'Solar + Battery Bundle' };
const pkg = packageNames[goal] || packageNames.solar_plus_battery;

// Lead ID (use from estimate if provided, else generate)
const lead_id = body.lead_id || ('JBI-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4));

// ============================================
// GOOGLE MAPS + SALES EMAIL
// ============================================
const mapsUrl = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(body.address);

const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#333;max-width:700px;margin:0 auto;padding:20px;">
<div style="background:linear-gradient(135deg,#1a5276,#27ae60);color:white;padding:24px 32px;border-radius:12px 12px 0 0;">
<h1 style="margin:0;font-size:22px;">${CONFIG.sales_email_subject_prefix} New Firm Quote Request</h1>
<p style="margin:8px 0 0;opacity:.85;">Lead ID: ${lead_id} | High-intent lead - bill uploaded</p></div>
<div style="border:1px solid #eee;border-top:none;padding:24px 32px;border-radius:0 0 12px 12px;">
<h2 style="color:#1a5276;font-size:18px;margin-top:0;">Customer Details</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr><td style="padding:8px 0;color:#888;width:140px;">Name</td><td style="padding:8px 0;font-weight:600;">${body.full_name}</td></tr>
<tr><td style="padding:8px 0;color:#888;">Email</td><td style="padding:8px 0;"><a href="mailto:${body.email}">${body.email}</a></td></tr>
<tr><td style="padding:8px 0;color:#888;">Mobile</td><td style="padding:8px 0;">${body.mobile || 'Not provided'}</td></tr>
<tr><td style="padding:8px 0;color:#888;">Address</td><td style="padding:8px 0;"><a href="${mapsUrl}">${body.address}</a></td></tr>
</table>
<h2 style="color:#1a5276;font-size:18px;">Package Comparison</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr><td style="padding:8px 0;color:#888;width:140px;">System</td><td style="padding:8px 0;">${rec_solar_kw > 0 ? rec_solar_kw + 'kW Solar' : ''} ${rec_battery_kwh > 0 ? '+ ' + rec_battery_kwh + 'kWh Battery' : ''}</td></tr>
<tr><td style="padding:8px 0;color:#888;">Economy</td><td style="padding:8px 0;">$${economy.gross_price_aud.toLocaleString()} gross - $${stc_rebate_aud.toLocaleString()} STC = <strong style="color:#27ae60">$${economy.net_price_aud.toLocaleString()}</strong></td></tr>
<tr><td style="padding:8px 0;color:#888;">Premium</td><td style="padding:8px 0;">$${premium.gross_price_aud.toLocaleString()} gross - $${stc_rebate_aud.toLocaleString()} STC = <strong style="color:#27ae60">$${premium.net_price_aud.toLocaleString()}</strong></td></tr>
<tr><td style="padding:8px 0;color:#888;">Monthly Savings</td><td style="padding:8px 0;">$${Math.round(sav_min)} - $${Math.round(sav_max)}</td></tr>
<tr><td style="padding:8px 0;color:#888;">STC Zone</td><td style="padding:8px 0;">${zone_label} (${total_stcs} STCs)</td></tr>
</table>
${body.notes ? '<h2 style="color:#1a5276;font-size:18px;">Notes</h2><p style="background:#f8f9fa;padding:16px;border-radius:8px;">' + body.notes + '</p>' : ''}
${fileInfo ? '<h2 style="color:#1a5276;font-size:18px;">Uploaded Bill</h2><p>File: ' + fileInfo.fileName + ' (' + Math.round(fileInfo.fileSize/1024) + ' KB)</p>' : ''}
<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
<p style="color:#888;font-size:12px;">Lead ${lead_id} | Generated ${new Date().toISOString()}</p>
</div></body></html>`;

// ============================================
// RESPONSE
// ============================================
return [{ json: {
  success: true,
  lead_id: lead_id,
  message: 'Firm quote request received. Our team will contact you within 24 hours.',
  quote_reference: lead_id,
  recommended_package: pkg,
  packages: { economy, premium },
  system: { solar_kw: rec_solar_kw, battery_kwh: rec_battery_kwh },
  stc_rebate: { zone: detected_zone, zone_label, total_stcs, rebate_aud: stc_rebate_aud },
  price_range_aud: [economy.net_price_aud, premium.net_price_aud],
  estimated_monthly_savings_aud: [Math.round(sav_min), Math.round(sav_max)],
  customer: { full_name: body.full_name, email: body.email, mobile: body.mobile || '', address: body.address, goal, phase, notes: body.notes || '' },
  file_received: fileInfo ? { name: fileInfo.fileName, size_kb: Math.round(fileInfo.fileSize / 1024), type: fileInfo.extension } : null,
  maps_url: mapsUrl,
  next_steps: [
    'Bill will be analysed by our engineering team',
    'Site assessment scheduled within 48 hours',
    'Detailed quote with panel/inverter specs provided',
    'No obligation - compare with other quotes',
  ],
  _sales_email_to: CONFIG.sales_email_to,
  _sales_email_subject: CONFIG.sales_email_subject_prefix + ' ' + body.full_name + ' - ' + pkg + ' [' + lead_id + ']',
  _sales_email_html: emailHtml,
}}];
