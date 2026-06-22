#!/usr/bin/env node
/**
 * MVP: convierte el resultado crudo de BigQuery (formato {rows:[{f:[{v}]}]})
 * en data/tracking.json, compacto y listo para el dashboard.
 *
 * Fuente: export de execute_sql_readonly de la vista vw_marketing_daily_campaign.
 * Esto es SOLO para el MVP visual; el refresh automático vía Service Account
 * se arma después.
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) { console.error('Uso: node build_mvp_data.js <archivo_bq.txt>'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const cols = raw.schema.fields.map(f => f.name);
const idx = Object.fromEntries(cols.map((c, i) => [c, i]));

const num = v => (v === null || v === undefined || v === '' ? 0 : +v);

const rows = raw.rows.map(r => {
  const g = name => r.f[idx[name]].v;
  return {
    date: g('date'),
    agencia: g('agencia'),
    cuenta: g('cuenta'),
    plataforma: g('platform'),
    objetivo: g('objetivo'),
    spend: num(g('spend')),
    impressions: num(g('impressions')),
    clicks: num(g('clicks')),
    reach: num(g('reach')),
    views: num(g('views')),
    engagements: num(g('engagements')),
    conversions: num(g('conversions')),
  };
}).filter(r => r.date && (r.spend > 0 || r.impressions > 0));

const out = {
  updated: new Date().toISOString(),
  nota: 'MVP de demostración · agencia derivada del nombre de la cuenta (provisional) · gasto en moneda nativa sin convertir',
  rango: { min: rows.reduce((m, r) => r.date < m ? r.date : m, '9999'), max: rows.reduce((m, r) => r.date > m ? r.date : m, '0000') },
  rows,
};

const dest = path.join(__dirname, 'data', 'tracking.json');
fs.writeFileSync(dest, JSON.stringify(out));
const agencias = [...new Set(rows.map(r => r.agencia))];
const cuentas = new Set(rows.map(r => r.cuenta));
console.log(`OK · ${rows.length} filas · ${cuentas.size} cuentas · agencias: ${agencias.join(', ')} · ${out.rango.min}→${out.rango.max} · ${(fs.statSync(dest).size/1024).toFixed(0)} KB`);
