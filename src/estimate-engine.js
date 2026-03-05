// ============================================
// SOLAR + BATTERY ESTIMATION ENGINE v2.0
// n8n Code Node for POST /solar-estimate
// ============================================
// >>> EDIT THIS CONFIG TO ADJUST ALL ESTIMATES <<<

const CONFIG = {
  // --- Electricity Assumptions ---
  electricity_rate_aud_per_kwh: 0.30,
  avg_days_per_month: 30.44,

  // --- Solar Panel Sizing ---
  solar: {
    kwh_per_kw_per_day: 4.0,
    coverage_min: 0.80,
    coverage_max: 1.00,
    sizes_kw: [3.3, 5, 6.6, 8, 10, 13.2, 15, 20],
    tiers: {
      economy: {
        label: 'Economy',
        panel_type: 'Budget panels + string inverter',
        warranty_years: 10,
        price_per_kw: 900,
      },
      premium: {
        label: 'Premium',
        panel_type: 'Tier-1 panels + microinverter',
        warranty_years: 25,
        price_per_kw: 1300,
      },
    },
  },

  // --- Battery Sizing ---
  battery: {
    daily_coverage: 0.60,
    sizes_kwh: [5, 10, 13.5, 15, 20],
    dod_factor: 1.25,        // depth-of-discharge (lithium 80%)
    inefficiency_factor: 1.1, // 10% system losses
    tiers: {
      economy: {
        label: 'Economy',
        battery_type: 'Standard lithium',
        warranty_years: 10,
        price_per_kwh: 800,
      },
      premium: {
        label: 'Premium',
        battery_type: 'Premium lithium (Tesla/BYD)',
        warranty_years: 15,
        price_per_kwh: 1200,
      },
    },
    retrofit_premium: 1.15,
  },

  // --- Savings Assumptions ---
  savings: {
    self_consumption_no_battery_min: 0.30,
    self_consumption_no_battery_max: 0.50,
    self_consumption_with_battery_min: 0.70,
    self_consumption_with_battery_max: 0.85,
    feed_in_tariff: 0.05,
  },

  // --- STC Rebates ---
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
};

// ============================================
// INPUT EXTRACTION
// ============================================
const body = $input.first().json.body || $input.first().json;

// --- HONEYPOT ---
if (body.website || body._gotcha || body.honeypot) {
  return [{ json: { success: false, error: 'Invalid submission.' } }];
}

// --- VALIDATION ---
const required = ['full_name', 'email', 'bill_monthly_aud'];
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

const validGoals = ['solar_only', 'battery_only', 'solar_plus_battery'];
const goal = validGoals.includes(body.goal) ? body.goal : 'solar_plus_battery';
const validPhases = ['single', 'two', 'three'];
const phase = validPhases.includes(body.phase) ? body.phase : 'single';

// ============================================
// ZONE DETECTION (from postcode)
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
// ESTIMATION LOGIC
// ============================================
const monthly_kwh = bill / CONFIG.electricity_rate_aud_per_kwh;
const daily_kwh = monthly_kwh / CONFIG.avg_days_per_month;
const annual_kwh = monthly_kwh * 12;

const existing_solar_kw = body.has_solar ? (parseFloat(body.solar_kw) || 0) : 0;
const existing_battery_kwh = body.has_battery ? (parseFloat(body.battery_kwh) || 0) : 0;

// Solar sizing
let rec_solar_kw = 0;
if (goal === 'solar_only' || goal === 'solar_plus_battery') {
  const target_daily = daily_kwh * CONFIG.solar.coverage_max;
  const needed_kw = target_daily / CONFIG.solar.kwh_per_kw_per_day;
  const net_kw = Math.max(needed_kw - existing_solar_kw, 0);
  rec_solar_kw = CONFIG.solar.sizes_kw.find(s => s >= net_kw)
    || CONFIG.solar.sizes_kw[CONFIG.solar.sizes_kw.length - 1];
}

// Battery sizing
let rec_battery_kwh = 0;
if (goal === 'battery_only' || goal === 'solar_plus_battery') {
  const target_kwh = daily_kwh * CONFIG.battery.daily_coverage;
  const net_kwh = Math.max(target_kwh - existing_battery_kwh, 0);
  rec_battery_kwh = CONFIG.battery.sizes_kwh.find(s => s >= net_kwh)
    || CONFIG.battery.sizes_kwh[CONFIG.battery.sizes_kwh.length - 1];
}

const phase_multiplier = phase === 'three' ? 1.08 : phase === 'two' ? 1.04 : 1.0;

// ============================================
// STC REBATE CALCULATION
// ============================================
const solar_stcs = rec_solar_kw > 0 ? Math.floor(rec_solar_kw * zone_rating * CONFIG.stc.deeming_years) : 0;
const battery_stcs = rec_battery_kwh > 0 ? Math.floor(rec_battery_kwh * CONFIG.stc.battery_stcs_per_kwh) : 0;
const total_stcs = solar_stcs + battery_stcs;
const stc_rebate_aud = total_stcs * CONFIG.stc.stc_price_aud;

// ============================================
// PACKAGE TIER PRICING
// ============================================
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
  return {
    tier: tierName,
    label: st.label,
    panel_type: st.panel_type,
    battery_type: bt.battery_type,
    warranty_solar: st.warranty_years,
    warranty_battery: bt.warranty_years,
    gross_price_aud: gross,
    stc_rebate_aud: stc_rebate_aud,
    net_price_aud: net,
    solar_cost_component: Math.round(solar_cost * phase_multiplier / 100) * 100,
  };
}

const economy = calcTier('economy');
const premium = calcTier('premium');

// ============================================
// SAVINGS CALCULATION
// ============================================
const hasBatt = rec_battery_kwh > 0;
const sc_min = hasBatt ? CONFIG.savings.self_consumption_with_battery_min : CONFIG.savings.self_consumption_no_battery_min;
const sc_max = hasBatt ? CONFIG.savings.self_consumption_with_battery_max : CONFIG.savings.self_consumption_no_battery_max;
const total_solar_kw = existing_solar_kw + rec_solar_kw;
const daily_gen = total_solar_kw * CONFIG.solar.kwh_per_kw_per_day;
const annual_gen = daily_gen * 365;

const sav_min = ((annual_gen * sc_min * CONFIG.electricity_rate_aud_per_kwh) + (annual_gen * (1 - sc_max) * CONFIG.savings.feed_in_tariff)) / 12;
const sav_max = ((annual_gen * sc_max * CONFIG.electricity_rate_aud_per_kwh) + (annual_gen * (1 - sc_min) * CONFIG.savings.feed_in_tariff)) / 12;

// ============================================
// EXPLANATION BULLETS
// ============================================
const bullets = [];
if (rec_solar_kw > 0) {
  bullets.push('Recommended ' + rec_solar_kw + 'kW solar system');
  bullets.push('Estimated daily generation: ' + daily_gen.toFixed(1) + ' kWh');
}
if (rec_battery_kwh > 0) {
  bullets.push('Recommended ' + rec_battery_kwh + 'kWh battery storage');
  bullets.push('Battery covers ~' + Math.round(CONFIG.battery.daily_coverage * 100) + '% of overnight usage');
}
bullets.push('Based on $' + bill + '/month bill (~' + Math.round(monthly_kwh) + ' kWh/month)');
if (stc_rebate_aud > 0) bullets.push('STC government rebate: ' + total_stcs + ' certificates x $' + CONFIG.stc.stc_price_aud + ' = -$' + stc_rebate_aud.toLocaleString());
if (existing_solar_kw > 0) bullets.push('Accounts for existing ' + existing_solar_kw + 'kW solar');
if (existing_battery_kwh > 0) bullets.push('Accounts for existing ' + existing_battery_kwh + 'kWh battery');
if (phase !== 'single') bullets.push(phase.charAt(0).toUpperCase() + phase.slice(1) + '-phase supply (+' + Math.round((phase_multiplier - 1) * 100) + '% inverter premium)');

const packageNames = {
  solar_only: 'Solar Power Package',
  battery_only: 'Battery Storage Package',
  solar_plus_battery: 'Solar + Battery Bundle',
};
const pkg = packageNames[goal] || packageNames.solar_plus_battery;

// ============================================
// LEAD ID
// ============================================
const lead_id = 'JBI-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

// ============================================
// HTML REPORT
// ============================================
const d = new Date().toLocaleDateString('en-AU');
const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Solar Estimate - ${body.full_name}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;padding:20px;color:#333}
.r{max-width:800px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.hd{background:linear-gradient(135deg,#1a5276 0%,#27ae60 100%);color:#fff;padding:48px 40px}
.hd h1{font-size:28px;margin-bottom:8px;font-weight:700}.hd p{opacity:.85;font-size:15px}
.s{padding:28px 40px;border-bottom:1px solid #eee}
.s h2{color:#1a5276;margin-bottom:16px;font-size:20px;font-weight:600}
.pg{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
.pc{border:2px solid #e0e0e0;border-radius:14px;padding:24px;text-align:center;position:relative}
.pc.pm{border-color:#27ae60}
.pc .badge{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#27ae60;color:#fff;padding:4px 16px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase}
.pc h3{font-size:18px;color:#1a5276;margin-bottom:12px}
.pc .gross{text-decoration:line-through;color:#999;font-size:14px}
.pc .rebate{color:#27ae60;font-weight:600;font-size:14px;margin:4px 0}
.pc .net{font-size:32px;font-weight:800;color:#1a5276;margin:8px 0}
.pc .det{font-size:13px;color:#666;margin-top:8px}
.pc .warr{font-weight:600;margin-top:6px;font-size:13px}
.hl{background:#eafaf1;border-radius:12px;padding:24px;margin:12px 0}
.sv{font-size:24px;color:#2ecc71;font-weight:700}
.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.gi{background:#f8f9fa;border-radius:10px;padding:18px}
.gi label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.8px;font-weight:600}
.gi .v{font-size:24px;font-weight:700;color:#1a5276;margin-top:6px}
ul{padding-left:20px}li{margin:8px 0;color:#555;line-height:1.6;font-size:15px}
.ct{background:linear-gradient(135deg,#27ae60,#2ecc71);color:#fff;padding:32px 40px;text-align:center}
.ct p{font-size:18px;font-weight:600}.ct .sub{font-size:14px;opacity:.85;margin-top:8px;font-weight:400}
.ft{padding:24px 40px;text-align:center;color:#aaa;font-size:11px;line-height:1.6}
@media print{body{background:#fff;padding:0}.r{box-shadow:none;border-radius:0}}
@media(max-width:600px){.pg,.g{grid-template-columns:1fr}.hd{padding:32px 24px}.s{padding:24px}}
</style></head><body><div class="r">
<div class="hd"><h1>${pkg}</h1><p>Prepared for ${body.full_name} | ${d} | Ref: ${lead_id}</p></div>
<div class="s"><h2>Your Packages</h2>
<div class="pg">
<div class="pc"><h3>Economy</h3><div class="gross">$${economy.gross_price_aud.toLocaleString()}</div><div class="rebate">STC Rebate: -$${stc_rebate_aud.toLocaleString()}</div><div class="net">$${economy.net_price_aud.toLocaleString()}</div><div class="det">${economy.panel_type}</div>${rec_battery_kwh > 0 ? '<div class="det">' + economy.battery_type + '</div>' : ''}<div class="warr">${economy.warranty_solar}-year warranty</div></div>
<div class="pc pm"><div class="badge">Recommended</div><h3>Premium</h3><div class="gross">$${premium.gross_price_aud.toLocaleString()}</div><div class="rebate">STC Rebate: -$${stc_rebate_aud.toLocaleString()}</div><div class="net">$${premium.net_price_aud.toLocaleString()}</div><div class="det">${premium.panel_type}</div>${rec_battery_kwh > 0 ? '<div class="det">' + premium.battery_type + '</div>' : ''}<div class="warr">${premium.warranty_solar}-year warranty</div></div>
</div></div>
<div class="s"><div class="hl" style="background:#e8f8f5"><div class="sv">Save $${Math.round(sav_min)} &ndash; $${Math.round(sav_max)} /month</div>
<p style="color:#666;margin-top:6px;font-size:14px">~$${Math.round(sav_min*12).toLocaleString()} &ndash; $${Math.round(sav_max*12).toLocaleString()} per year</p></div></div>
<div class="s"><h2>System Details</h2><div class="g">
${rec_solar_kw > 0 ? '<div class="gi"><label>Solar System</label><div class="v">' + rec_solar_kw + ' kW</div></div>' : ''}
${rec_battery_kwh > 0 ? '<div class="gi"><label>Battery Storage</label><div class="v">' + rec_battery_kwh + ' kWh</div></div>' : ''}
<div class="gi"><label>Monthly Usage</label><div class="v">${Math.round(monthly_kwh)} kWh</div></div>
<div class="gi"><label>Monthly Bill</label><div class="v">$${bill}</div></div>
<div class="gi"><label>STC Zone</label><div class="v">${zone_label}</div></div>
<div class="gi"><label>STCs Claimed</label><div class="v">${total_stcs} ($${stc_rebate_aud.toLocaleString()})</div></div>
</div></div>
<div class="s"><h2>How We Calculated This</h2>
<ul>${bullets.map(b => '<li>' + b + '</li>').join('')}</ul></div>
<div class="ct"><p>Upload your electricity bill for a firm quote</p>
<p class="sub">Our team will review and provide a detailed, obligation-free quote within 24 hours.</p></div>
<div class="ft"><p>Ballpark estimate only. Final pricing depends on site inspection, roof type, shading analysis, and panel/inverter selection.</p>
<p style="margin-top:8px">Ref: ${lead_id} | Generated ${new Date().toISOString()}</p></div>
</div></body></html>`;

// ============================================
// RESPONSE
// ============================================
return [{ json: {
  success: true,
  lead_id: lead_id,
  recommended_package: pkg,
  system: {
    solar_kw: rec_solar_kw,
    battery_kwh: rec_battery_kwh,
    existing_solar_kw,
    existing_battery_kwh,
  },
  packages: {
    economy: economy,
    premium: premium,
  },
  price_range_aud: [economy.net_price_aud, premium.net_price_aud],
  stc_rebate: {
    zone: detected_zone,
    zone_label: zone_label,
    zone_rating: zone_rating,
    solar_stcs: solar_stcs,
    battery_stcs: battery_stcs,
    total_stcs: total_stcs,
    stc_price_aud: CONFIG.stc.stc_price_aud,
    rebate_aud: stc_rebate_aud,
  },
  estimated_monthly_savings_aud: [Math.round(sav_min), Math.round(sav_max)],
  estimated_annual_savings_aud: [Math.round(sav_min * 12), Math.round(sav_max * 12)],
  explanation_bullets: bullets,
  usage: {
    monthly_kwh: Math.round(monthly_kwh),
    daily_kwh: Math.round(daily_kwh * 10) / 10,
    annual_kwh: Math.round(annual_kwh),
  },
  customer: {
    full_name: body.full_name,
    email: body.email,
    mobile: body.mobile || '',
    address: body.address || '',
    postcode: postcodeStr,
    goal,
    phase,
    notes: body.notes || '',
  },
  maps_url: body.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(body.address) : null,
  next_step: {
    cta: 'Upload your electricity bill for a firm quote',
    requires_bill_upload: true,
    message: 'Our team will review your bill and provide a detailed, obligation-free quote within 24 hours.',
  },
  report_id: lead_id,
  pdf_url: 'data:text/html;base64,' + Buffer.from(html).toString('base64'),
  report_html: html,
  _bill_monthly_aud: bill,
  // Client-side recalculation params for battery slider
  _calc_params: {
    daily_kwh: daily_kwh,
    electricity_rate: CONFIG.electricity_rate_aud_per_kwh,
    feed_in_tariff: CONFIG.savings.feed_in_tariff,
    phase_multiplier: phase_multiplier,
    solar_kw: rec_solar_kw,
    kwh_per_kw_per_day: CONFIG.solar.kwh_per_kw_per_day,
    battery_sizes: CONFIG.battery.sizes_kwh,
    battery_dod_factor: CONFIG.battery.dod_factor,
    battery_inefficiency_factor: CONFIG.battery.inefficiency_factor,
    battery_price_economy: CONFIG.battery.tiers.economy.price_per_kwh,
    battery_price_premium: CONFIG.battery.tiers.premium.price_per_kwh,
    solar_cost_economy: economy.solar_cost_component,
    solar_cost_premium: premium.solar_cost_component,
    retrofit_premium: CONFIG.battery.retrofit_premium,
    stc_solar_rebate: solar_stcs * CONFIG.stc.stc_price_aud,
    stc_battery_per_kwh: CONFIG.stc.battery_stcs_per_kwh * CONFIG.stc.stc_price_aud,
    self_consumption: {
      no_battery: { min: CONFIG.savings.self_consumption_no_battery_min, max: CONFIG.savings.self_consumption_no_battery_max },
      with_battery: { min: CONFIG.savings.self_consumption_with_battery_min, max: CONFIG.savings.self_consumption_with_battery_max },
    },
    goal: goal,
  },
}}];
