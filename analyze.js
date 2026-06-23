#!/usr/bin/env node
/**
 * Agente de análisis diario de campañas con Gemini.
 * Aplica la metodología del skill "meta-ads-analyzer" (Breakdown Effect, fase de
 * aprendizaje, eficiencia marginal, KPI por objetivo) sobre data/tracking.json y
 * genera data/recommendations.json con recomendaciones de optimización por cuenta.
 *
 * Requiere GEMINI_API_KEY. Modelo configurable con GEMINI_MODEL.
 * Uso:  GEMINI_API_KEY=xxx node analyze.js
 */
const fs = require('fs');
const path = require('path');

const BQ_PROJECT = process.env.BQ_PROJECT || 'garnier-436600';
const BQ_DATASET = 'Garnier';
const BQ_TABLE   = 'campaign_recommendations';
const useBQ = !!process.env.GOOGLE_APPLICATION_CREDENTIALS; // escribe a BigQuery si hay credenciales de Service Account

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL   = process.env.GEMINI_MODEL || 'gemini-2.5-flash'; // poné el id exacto del Flash nuevo (ej. gemini-3.5-flash) si aplica
const PRICE_IN  = +(process.env.GEMINI_PRICE_IN  || 0.30);  // USD por 1M tokens de entrada
const PRICE_OUT = +(process.env.GEMINI_PRICE_OUT || 2.50);  // USD por 1M tokens de salida
const MAX_CAMP  = 20;   // campañas por cuenta enviadas al modelo (top por inversión)
const CONCURRENCY = 4;
const LIMIT = +(process.env.LIMIT || 0); // 0 = todas las cuentas

if (!API_KEY) { console.error('ERROR: falta GEMINI_API_KEY'); process.exit(1); }

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tracking.json'), 'utf8'));
const TIPOS = {
  'Reconocimiento':'Awareness','Standard':'Awareness','Tracking':'Awareness','Anuncio gráfico':'Awareness',
  'Tráfico':'Tráfico','Búsqueda':'Tráfico','Generación de demanda':'Tráfico','LANDING_PAGE':'Tráfico',
  'Video':'Views','In-Stream Video':'Views',
  'Ventas':'Conversión','Conversiones':'Conversión','Clientes potenciales':'Conversión','Instalaciones de la app':'Conversión',
  'Interacción':'Interacción',
};
const tipoDe = o => TIPOS[o] || 'Otro';
const r2 = n => Math.round(n*100)/100;

// Agrupar detalle por cuenta
const porCuenta = {};
for (const r of data.detalle) {
  (porCuenta[r.cuenta] = porCuenta[r.cuenta] || { cuenta:r.cuenta, agencia:r.agencia, pais:r.pais, camps:[] }).camps.push(r);
}
let cuentas = Object.values(porCuenta);
if (LIMIT) cuentas = cuentas.slice(0, LIMIT);

const SYSTEM = `Eres un analista senior de campañas digitales (Meta, Google Ads, DV360, TikTok) que aplica la metodología del skill "Meta Ads Analyzer".
Principios obligatorios:
- Holístico primero: evalúa la cuenta antes de drillear a campañas.
- Dinámico sobre estático: razona sobre tendencias y eficiencia marginal (Breakdown Effect), no fotos puntuales.
- NUNCA recomiendes pausar una campaña/segmento solo porque su CPA/CPM promedio sea más alto: eso refleja costo marginal, no mal desempeño.
- Usa el KPI correcto según el objetivo: Awareness→CPM y alcance; Tráfico→CPC y CTR; Views→CPV; Conversión→CPA y conversiones; Interacción→CPE.
- Enmarca los cambios como hipótesis testeables, no órdenes. Justifica con datos.
- Sé concreto, accionable y breve. Responde en español.
- FORMATO DE INSIGHT ACCIONABLE: cada recomendación tiene un "titulo" que es UNA frase, en imperativo (empieza con verbo), específica y con la métrica/señal clave — es el insight que se lee de un vistazo. Luego "diagnostico" (el porqué con datos), "recomendacion" (el cómo concreto) e "impacto" (resultado esperado). El título NO debe ser genérico ("Optimizar la campaña"); debe decir qué hacer y por qué en una línea.
Limitaciones de los datos: son agregados a nivel campaña de los últimos 90 días (sin nivel ad set, sin diagnósticos de relevancia ni eventos de fase de aprendizaje). No inventes métricas que no estén. El gasto está en moneda nativa (Colombia en COP, el resto USD).`;

const schema = {
  type:'object',
  properties:{
    resumen:{ type:'string', description:'Diagnóstico ejecutivo de la cuenta (2-4 frases).' },
    recomendaciones:{ type:'array', items:{ type:'object', properties:{
      campana:{type:'string'},
      objetivo:{type:'string', enum:['Awareness','Tráfico','Views','Conversión','Interacción','General']},
      prioridad:{type:'string', enum:['alta','media','baja']},
      titulo:{type:'string', description:'Insight accionable en UNA sola frase: empieza con verbo en imperativo, es específico e incluye la métrica/señal clave. Ej: "Audita el píxel de conversión: 341 clics y 0 ventas registradas".'},
      diagnostico:{type:'string', description:'Qué está pasando y por qué (1-2 frases, con datos).'},
      recomendacion:{type:'string', description:'El cómo concreto: pasos accionables.'},
      impacto:{type:'string', description:'Resultado esperado si se aplica.'}
    }, required:['campana','objetivo','prioridad','titulo','diagnostico','recomendacion','impacto'] } }
  },
  required:['resumen','recomendaciones']
};

function promptCuenta(c) {
  // Agregar por campaña (el detalle puede venir partido por mes)
  const byC = {};
  for (const r of c.camps) {
    const k = r.campana+'|'+r.plataforma+'|'+r.objetivo;
    const g = byC[k] || (byC[k] = { campana:r.campana, plataforma:r.plataforma, objetivo:r.objetivo, inicio:r.inicio, fin:r.fin, spend:0, impressions:0, clicks:0, views:0, conversions:0 });
    g.spend+=r.spend; g.impressions+=r.impressions; g.clicks+=r.clicks; g.views+=r.views; g.conversions+=r.conversions;
    if (r.inicio<g.inicio) g.inicio=r.inicio; if (r.fin>g.fin) g.fin=r.fin;
  }
  const camps = Object.values(byC);
  const tot = camps.reduce((a,r)=>({spend:a.spend+r.spend,impr:a.impr+r.impressions,clk:a.clk+r.clicks,conv:a.conv+r.conversions}),{spend:0,impr:0,clk:0,conv:0});
  const rows = camps.slice().sort((a,b)=>b.spend-a.spend).slice(0,MAX_CAMP).map(r=>{
    const ctr=r.impressions?r.clicks/r.impressions*100:0, cpc=r.clicks?r.spend/r.clicks:0,
          cpm=r.impressions?r.spend/r.impressions*1000:0, cpv=r.views?r.spend/r.views:0,
          cpa=r.conversions?r.spend/r.conversions:0;
    return `- "${r.campana}" | ${r.plataforma} | ${tipoDe(r.objetivo)} | ${r.inicio}→${r.fin} | gasto ${r2(r.spend)} | impr ${r.impressions} | clics ${r.clicks} | CTR ${r2(ctr)}% | CPC ${r2(cpc)} | CPM ${r2(cpm)} | CPV ${r2(cpv)} | conv ${r2(r.conversions)} | CPA ${r2(cpa)}`;
  }).join('\n');
  return `CUENTA: ${c.cuenta} · Agencia: ${c.agencia} · País: ${c.pais}
Totales 90 días: gasto ${r2(tot.spend)} | impresiones ${tot.impr} | clics ${tot.clk} | conversiones ${r2(tot.conv)} | ${camps.length} campañas
Campañas (top ${Math.min(MAX_CAMP,camps.length)} por inversión):
${rows}

Analiza esta cuenta con la metodología y entrega un resumen + recomendaciones priorizadas (máx 5), cada una asociada a una campaña concreta (o "General") y su objetivo.`;
}

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    systemInstruction:{ parts:[{ text: SYSTEM }] },
    contents:[{ parts:[{ text: prompt }] }],
    generationConfig:{ responseMimeType:'application/json', responseSchema: schema, temperature: 0.4 },
  };
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0,200)}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const usage = json.usageMetadata || {};
  return { parsed: JSON.parse(text), inTok: usage.promptTokenCount||0, outTok: usage.candidatesTokenCount||0 };
}

(async () => {
  const recomendaciones = [], resumenes = [];
  let inTok = 0, outTok = 0, ok = 0, fail = 0;

  async function worker(queue) {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      try {
        const { parsed, inTok:i, outTok:o } = await callGemini(promptCuenta(c));
        inTok += i; outTok += o; ok++;
        resumenes.push({ cuenta:c.cuenta, agencia:c.agencia, pais:c.pais, resumen: parsed.resumen||'' });
        for (const rec of (parsed.recomendaciones||[])) {
          recomendaciones.push({ agencia:c.agencia, pais:c.pais, cuenta:c.cuenta, ...rec });
        }
        console.log(`OK  ${c.cuenta} (${(parsed.recomendaciones||[]).length} recos)`);
      } catch (e) { fail++; console.error(`FALLO ${c.cuenta}: ${e.message}`); }
    }
  }
  const queue = cuentas.slice();
  await Promise.all(Array.from({length:CONCURRENCY}, ()=>worker(queue)));

  const costo = r2(inTok/1e6*PRICE_IN + outTok/1e6*PRICE_OUT);
  const runTs = new Date().toISOString();
  const out = {
    updated: runTs,
    modelo: MODEL,
    cuentas_analizadas: ok, fallidas: fail,
    tokens: { entrada: inTok, salida: outTok },
    costo_estimado_usd: costo,
    recomendaciones, resumenes,
  };
  fs.writeFileSync(path.join(__dirname,'data','recommendations.json'), JSON.stringify(out));
  console.log(`\nLISTO · ${ok} cuentas · ${recomendaciones.length} recomendaciones · tokens ${inTok}/${outTok} · costo ~$${costo} (${MODEL})`);

  // Guardar en BigQuery (historial). Crea la tabla si no existe.
  if (useBQ && recomendaciones.length) {
    try {
      const { BigQuery } = require('@google-cloud/bigquery');
      const bq = new BigQuery({ projectId: BQ_PROJECT });
      await bq.query(`CREATE TABLE IF NOT EXISTS \`${BQ_PROJECT}.${BQ_DATASET}.${BQ_TABLE}\` (
        run_ts TIMESTAMP, modelo STRING, agencia STRING, pais STRING, cuenta STRING,
        campana STRING, objetivo STRING, prioridad STRING, titulo STRING,
        diagnostico STRING, recomendacion STRING, impacto STRING )`);
      await bq.query(`ALTER TABLE \`${BQ_PROJECT}.${BQ_DATASET}.${BQ_TABLE}\` ADD COLUMN IF NOT EXISTS titulo STRING`);
      const rows = recomendaciones.map(r => ({
        run_ts: runTs, modelo: MODEL, agencia: r.agencia, pais: r.pais, cuenta: r.cuenta,
        campana: r.campana, objetivo: r.objetivo, prioridad: r.prioridad, titulo: r.titulo,
        diagnostico: r.diagnostico, recomendacion: r.recomendacion, impacto: r.impacto,
      }));
      await bq.dataset(BQ_DATASET).table(BQ_TABLE).insert(rows);
      console.log(`BigQuery · ${rows.length} filas insertadas en ${BQ_DATASET}.${BQ_TABLE}`);
    } catch (e) {
      console.error('Aviso: no se pudo escribir en BigQuery:', e.message);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
