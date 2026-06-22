#!/usr/bin/env node
/** Une el detalle de campañas de BigQuery con data/homologacion.json
 *  -> data/tracking.json (detalle real con agencia/pais/cuenta homologada). */
const fs=require('fs');
const SRC=process.argv[2];
const raw=JSON.parse(fs.readFileSync(SRC,'utf8'));
const cols=raw.schema.fields.map(f=>f.name);
const idx=Object.fromEntries(cols.map((c,i)=>[c,i]));
const lookup=JSON.parse(fs.readFileSync('data/homologacion.json','utf8'));
const num=v=>(v===null||v===undefined||v===''?0:+v);

const detalle=[]; const sinMatch={};
raw.rows.forEach(r=>{
  const g=n=>r.f[idx[n]].v;
  const plat=g('platform'), acc=g('account_name');
  const h=lookup[plat+'||'+acc];
  if(!h){ sinMatch[plat+'||'+acc]=(sinMatch[plat+'||'+acc]||0)+1; return; }
  detalle.push({
    agencia:h.ag, pais:h.pais, cuenta:h.hom,
    campana:g('campana')||'(sin nombre)', plataforma:plat,
    objetivo:g('objetivo'), inicio:g('inicio'), fin:g('fin'), last_spend:g('last_spend'),
    spend:num(g('spend')), impressions:num(g('impressions')), clicks:num(g('clicks')),
    reach:num(g('reach')), views:num(g('views')), engagements:num(g('engagements')), conversions:num(g('conversions')),
  });
});

const minD=detalle.reduce((m,r)=>r.inicio<m?r.inicio:m,'9999');
const maxD=detalle.reduce((m,r)=>r.fin>m?r.fin:m,'0000');
const prev=fs.existsSync('data/tracking.json')?JSON.parse(fs.readFileSync('data/tracking.json','utf8')):{};
const out={
  updated:new Date().toISOString(),
  nota:'Datos reales de BigQuery cruzados con tu tabla de homologación · gasto en moneda nativa sin convertir',
  rango:{min:minD,max:maxD},
  rows:prev.rows||[],
  detalle,
};
fs.writeFileSync('data/tracking.json',JSON.stringify(out));

console.log(`OK · detalle: ${detalle.length} filas · ${new Set(detalle.map(d=>d.cuenta)).size} cuentas · ${new Set(detalle.map(d=>d.agencia)).size} agencias`);
console.log('Agencias:',[...new Set(detalle.map(d=>d.agencia))].join(', '));
console.log('Países:',[...new Set(detalle.map(d=>d.pais))].join(', '));
const sm=Object.keys(sinMatch); if(sm.length){console.log(`\nSin match (${sm.length} combos platform||account_name, no cruzaron):`); sm.slice(0,15).forEach(k=>console.log('  ·',k));}
else console.log('\nTodos los registros cruzaron con la tabla ✔');
