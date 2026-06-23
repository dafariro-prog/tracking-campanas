#!/usr/bin/env node
/** Cruza planner_implementador.xlsx (Cuenta·Planner·Implementador) con las cuentas
 *  homologadas, genera data/planner.json (homologado -> {planner,implementador})
 *  y enriquece data/tracking.json. El cruce es por nombre normalizado + alias manuales. */
const fs = require('fs');
const pi = require('./pi_rows.json').slice(1).filter(r => r && r[0]);
const lookup = require('./data/homologacion.json');
const homs = [...new Set(Object.values(lookup).map(v => v.hom))];
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const homByNorm = new Map(homs.map(h => [norm(h), h]));

// Alias verificados a mano (la columna Cuenta usa nombres más cortos que el homologado)
const ALIAS = {
  'bcr': 'Banco de Costa Rica BCR',
  '1820': 'Café 1820',
  'lagar': 'El Lagar',
  'gravilias': 'Las Gravilias',
};

const planner = {};
const sinMatch = [];
pi.forEach(([cta, pl, im]) => {
  const n = norm(cta);
  const hom = homByNorm.get(n) || ALIAS[n];
  if (!hom) { sinMatch.push(cta); return; }
  planner[hom] = { planner: (pl || '').trim(), implementador: (im || '').trim() };
});
fs.writeFileSync('data/planner.json', JSON.stringify(planner));

// Enriquecer el tracking.json actual (refresh.js hace lo mismo en producción)
const data = JSON.parse(fs.readFileSync('data/tracking.json', 'utf8'));
const attach = arr => arr.forEach(r => {
  const p = planner[r.cuenta] || { planner: '', implementador: '' };
  r.planner = p.planner; r.implementador = p.implementador;
});
attach(data.detalle); attach(data.rows);
fs.writeFileSync('data/tracking.json', JSON.stringify(data));

const conPlanner = new Set(data.detalle.filter(r => r.planner).map(r => r.cuenta));
console.log(`planner.json: ${Object.keys(planner).length} cuentas mapeadas`);
console.log(`Cuentas con planner en el dashboard (activas): ${conPlanner.size}`);
console.log(`Planners: ${[...new Set(Object.values(planner).map(v => v.planner))].filter(Boolean).join(', ')}`);
console.log(`No cruzaron (no están en el universo del dashboard, ${sinMatch.length}): ${sinMatch.join(', ')}`);
