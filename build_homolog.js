#!/usr/bin/env node
/** Construye data/homologacion.json (lookup platform||account_name -> {hom,pais,agencia})
 *  y escribe in_list.sql con la lista de account_name para filtrar la vista. */
const fs=require('fs');
const rows=require('./homolog_rows.json');
const H=rows[0], data=rows.slice(1).filter(r=>r&&(r[1]||'').trim());
const c=n=>H.indexOf(n);
const cP=c('platform'),cA=c('account_name'),cHom=c('account_name_homologado'),cPais=c('Pais'),cAg=c('Agencia');

const PAIS_FIX={'costa rica':'Costa Rica','panama':'Panamá','el salvador':'El Salvador','guatemala':'Guatemala',
  'mexico':'México','republica dominicana':'República Dominicana','puerto rico':'Puerto Rico',
  'colombia':'Colombia','trinidad y tobago':'Trinidad y Tobago'};
const AG_FIX={'shift pn':'Shift PN','bbdo':'Garnier','phd':'PHD','diageo':'Diageo','loymark':'Loymark','panama':'Panama'};
const normPais=p=>{const k=(p||'').trim().toLowerCase();return PAIS_FIX[k]||(p||'').trim()||'—';};
const normAg=a=>{const k=(a||'').trim().toLowerCase();return AG_FIX[k]||(a||'').trim()||'Sin agencia';};

const lookup={};
const accs=new Set();
data.forEach(r=>{
  const plat=(r[cP]||'').trim(), acc=(r[cA]||'').trim();
  lookup[plat+'||'+acc]={hom:(r[cHom]||'').trim()||acc, pais:normPais(r[cPais]), ag:normAg(r[cAg])};
  accs.add(acc);
});
fs.writeFileSync('data/homologacion.json',JSON.stringify(lookup));

// Lista SQL escapada
const list=[...accs].map(a=>"'"+a.replace(/\\/g,"\\\\").replace(/'/g,"\\'")+"'").join(',');
fs.writeFileSync('in_list.sql',list);

const ags=[...new Set(Object.values(lookup).map(v=>v.ag))];
const paises=[...new Set(Object.values(lookup).map(v=>v.pais))];
console.log('lookup entries:',Object.keys(lookup).length,'| account_names únicos:',accs.size);
console.log('Agencias:',ags.join(', '));
console.log('Países:',paises.join(', '));
