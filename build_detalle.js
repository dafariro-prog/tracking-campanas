#!/usr/bin/env node
/** Agrega el array `detalle` (nivel campaña·plataforma·objetivo) a data/tracking.json */
const fs=require('fs'),path=require('path');
const SRC=process.argv[2];
if(!SRC){console.error('Uso: node build_detalle.js <archivo_bq.txt>');process.exit(1);}
const raw=JSON.parse(fs.readFileSync(SRC,'utf8'));
const cols=raw.schema.fields.map(f=>f.name);
const idx=Object.fromEntries(cols.map((c,i)=>[c,i]));
const num=v=>(v===null||v===undefined||v===''?0:+v);
const detalle=raw.rows.map(r=>{
  const g=n=>r.f[idx[n]].v;
  return {
    agencia:g('agencia'), cuenta:g('cuenta'), campana:g('campana')||'(sin nombre)',
    plataforma:g('platform'), objetivo:g('objetivo'),
    inicio:g('inicio'), fin:g('fin'), last_spend:g('last_spend'),
    spend:num(g('spend')), impressions:num(g('impressions')), clicks:num(g('clicks')),
    reach:num(g('reach')), views:num(g('views')), engagements:num(g('engagements')), conversions:num(g('conversions')),
  };
});
const file=path.join(__dirname,'data','tracking.json');
const data=JSON.parse(fs.readFileSync(file,'utf8'));
data.detalle=detalle;
fs.writeFileSync(file,JSON.stringify(data));
console.log(`OK · detalle: ${detalle.length} campañas·plat·obj · ${(fs.statSync(file).size/1024).toFixed(0)} KB total`);
