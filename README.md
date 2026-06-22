# Tracking de Campañas — Grupo Garnier

Dashboard público de tracking diario de campañas de pauta (Meta, Google Ads, DV360, TikTok),
agrupado por agencia (**Shift PN · Garnier · PHD · Diageo · Loymark · Panama**), país y cuenta.

- **Frontend:** `index.html` estático + Chart.js (sin build).
- **Datos:** `data/tracking.json`, generado desde la vista
  `garnier-436600.Garnier.vw_marketing_daily_campaign` (BigQuery) y cruzado con la tabla de
  homologación (`data/homologacion.json`) por `platform + account_name`.
- **Auto-actualización:** GitHub Actions corre `refresh.js` cada día y commitea la data;
  Vercel redeploya en cada push. Funciona aunque tu PC esté apagado.

## Ver en local
```bash
npm run serve      # http://localhost:4500
```

## Refrescar la data manualmente
Requiere una Service Account de GCP con acceso a BigQuery:
```bash
GOOGLE_APPLICATION_CREDENTIALS=./sa.json npm run refresh
```

## Puesta en marcha del auto-refresco (una sola vez)

1. **Service Account en GCP** (proyecto `garnier-436600`):
   - IAM & Admin → Service Accounts → crear una (ej. `tracking-bq`).
   - Roles: **BigQuery Data Viewer** + **BigQuery Job User**.
   - Crear una **clave JSON** y descargarla.
2. **Secret en GitHub:** repo → Settings → Secrets and variables → Actions → New secret
   - Nombre: `GCP_SA_KEY` · Valor: el contenido completo del JSON.
3. **Vercel:** New Project → importar este repo de GitHub → Deploy (framework: *Other*, sin build).
4. Listo: el workflow `.github/workflows/refresh.yml` corre a las 11:00 UTC (05:00 CR/PA) y
   también se puede lanzar a mano desde la pestaña **Actions** → *Run workflow*.

## Actualizar la tabla de homologación
Cuando cambie `Tabla homologada cuentas.xlsx` (columnas: `platform`, `account_name`,
`account_name_homologado`, `Pais`, `Agencia`):
```bash
node xlsx2json.js "Tabla homologada cuentas.xlsx" homolog_rows.json
node build_homolog.js     # regenera data/homologacion.json
git add data/homologacion.json && git commit -m "update homologación" && git push
```

## Notas
- El gasto está en **moneda nativa** (no se convierte): Meta en USD, Google Ads en la moneda de la cuenta.
- Estado de campaña: **>5 días sin consumo = Finalizada**, si no Activa.
- El detalle de campañas cubre 90 días; la serie diaria (gráfica) 60 días.
