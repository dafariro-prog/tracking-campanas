#!/usr/bin/env node
/** Agrega data.rows (serie diaria por cuenta) a data/tracking.json, uniendo homologación.
 *  Nota: esta serie NO trae objetivo (el filtro de objetivo no afecta la línea, sí el resto). */
const fs=require('fs');
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cols=raw.schema.fields.map(f=>f.name);
const idx=Object.fromEntries(cols.map((c,i)=>[c,i]));
const lookup=JSON.parse(fs.readFileSync('data/homologacion.json','utf8'));
const num=v=>(v===null||v===undefined||v===''?0:+v);

const rows=[]; let sin=0;
raw.rows.forEach(r=>{
  const g=n=>r.f[idx[n]].v;
  const plat=g('platform'), acc=g('account_name');
  const h=lookup[plat+'||'+acc]; if(!h){sin++;return;}
  rows.push({date:g('date'),agencia:h.ag,pais:h.pais,cuenta:h.hom,plataforma:plat,
    spend:num(g('spend')),impressions:num(g('impressions')),clicks:num(g('clicks')),
    views:num(g('views')),conversions:num(g('conversions'))});
});
const data=JSON.parse(fs.readFileSync('data/tracking.json','utf8'));
data.rows=rows;
data.rango_serie={min:rows.reduce((m,r)=>r.date<m?r.date:m,'9999'),max:rows.reduce((m,r)=>r.date>m?r.date:m,'0')};
fs.writeFileSync('data/tracking.json',JSON.stringify(data));
console.log(`OK · serie: ${rows.length} filas · ${data.rango_serie.min}→${data.rango_serie.max} · sin match: ${sin} · total JSON ${(fs.statSync('data/tracking.json').size/1024).toFixed(0)}KB`);
