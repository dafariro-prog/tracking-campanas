#!/usr/bin/env node
/**
 * Refresca data/tracking.json con datos REALES de la vista
 * garnier-436600.Garnier.vw_marketing_daily_campaign, cruzados con
 * data/homologacion.json (platform||account_name -> agencia/pais/cuenta).
 *
 * Pensado para correr en GitHub Actions (diario) con una Service Account de GCP.
 * Requiere la env var GOOGLE_APPLICATION_CREDENTIALS apuntando al JSON de la SA
 * (o GCP_SA_KEY con el contenido del JSON, que el workflow vuelca a un archivo).
 *
 * Local:  GOOGLE_APPLICATION_CREDENTIALS=./sa.json node refresh.js
 */
const fs = require('fs');
const path = require('path');
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT   = process.env.BQ_PROJECT || 'garnier-436600';
const VIEW      = '`garnier-436600.Garnier.vw_marketing_daily_campaign`';
const DAYS_DET  = 90;   // ventana del detalle de campañas
const DAYS_SER  = 60;   // ventana de la serie diaria

const lookup = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'homologacion.json'), 'utf8'));
const accounts = [...new Set(Object.keys(lookup).map(k => k.split('||')[1]))];
const num = v => (v === null || v === undefined || v === '' ? 0 : +v);
const dval = d => (d && d.value) ? d.value : d;  // BigQueryDate -> 'YYYY-MM-DD'

const bq = new BigQuery({ projectId: PROJECT });

const Q_DETALLE = `
  SELECT platform, account_name, campaign_name AS campana,
    COALESCE(objective,'(sin objetivo)') AS objetivo,
    MIN(date) inicio, MAX(date) fin, MAX(IF(spend>0,date,NULL)) last_spend,
    ROUND(SUM(spend),2) spend,
    CAST(SUM(impressions) AS INT64) impressions,
    CAST(SUM(clicks) AS INT64) clicks,
    CAST(SUM(reach) AS INT64) reach,
    CAST(SUM(views) AS INT64) views,
    CAST(SUM(engagements) AS INT64) engagements,
    ROUND(SUM(conversions),2) conversions
  FROM ${VIEW}
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${DAYS_DET} DAY)
    AND account_name IN UNNEST(@accounts)
  GROUP BY 1,2,3,4
  HAVING spend > 0 OR impressions > 0`;

const Q_SERIE = `
  SELECT date, platform, account_name,
    ROUND(SUM(spend),2) spend,
    CAST(SUM(impressions) AS INT64) impressions,
    CAST(SUM(clicks) AS INT64) clicks,
    CAST(SUM(views) AS INT64) views,
    ROUND(SUM(conversions),2) conversions
  FROM ${VIEW}
  WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL ${DAYS_SER} DAY)
    AND account_name IN UNNEST(@accounts)
  GROUP BY 1,2,3`;

async function run(query) {
  const [rows] = await bq.query({ query, params: { accounts }, location: 'US' });
  return rows;
}

(async () => {
  console.log(`Consultando BigQuery (${accounts.length} cuentas)…`);
  const [det, ser] = await Promise.all([run(Q_DETALLE), run(Q_SERIE)]);

  const detalle = [];
  for (const r of det) {
    const h = lookup[r.platform + '||' + r.account_name];
    if (!h) continue;
    detalle.push({
      agencia: h.ag, pais: h.pais, cuenta: h.hom,
      campana: r.campana || '(sin nombre)', plataforma: r.platform,
      objetivo: r.objetivo, inicio: dval(r.inicio), fin: dval(r.fin), last_spend: dval(r.last_spend),
      spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
      reach: num(r.reach), views: num(r.views), engagements: num(r.engagements), conversions: num(r.conversions),
    });
  }

  const rows = [];
  for (const r of ser) {
    const h = lookup[r.platform + '||' + r.account_name];
    if (!h) continue;
    rows.push({
      date: dval(r.date), agencia: h.ag, pais: h.pais, cuenta: h.hom, plataforma: r.platform,
      spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.clicks),
      views: num(r.views), conversions: num(r.conversions),
    });
  }

  const out = {
    updated: new Date().toISOString(),
    nota: 'Datos reales de BigQuery cruzados con tu tabla de homologación · gasto en moneda nativa sin convertir',
    rango: { min: detalle.reduce((m, r) => r.inicio < m ? r.inicio : m, '9999'),
             max: detalle.reduce((m, r) => r.fin > m ? r.fin : m, '0000') },
    rango_serie: { min: rows.reduce((m, r) => r.date < m ? r.date : m, '9999'),
                   max: rows.reduce((m, r) => r.date > m ? r.date : m, '0000') },
    rows, detalle,
  };
  fs.writeFileSync(path.join(__dirname, 'data', 'tracking.json'), JSON.stringify(out));
  console.log(`OK · ${detalle.length} campañas · ${rows.length} filas de serie · ` +
    `${new Set(detalle.map(d => d.cuenta)).size} cuentas · ${new Set(detalle.map(d => d.agencia)).size} agencias`);
})().catch(e => { console.error('FALLO refresh:', e.message); process.exit(1); });
