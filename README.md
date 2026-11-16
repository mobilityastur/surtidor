# Surtidor · precios de carburantes

App web con los precios de gasolina, diésel, GLP y GNC en España: un mapa de provincias coloreado según su precio típico, la lista de gasolineras más baratas de cada provincia y las más baratas cerca de ti.

## Cómo funciona

- `scripts/update.mjs` descarga los precios de todas las gasolineras del servicio REST del Ministerio y genera:
  - `data/resumen.json`: mediana, mínimo y número de gasolineras por provincia y combustible, y la referencia nacional (península y Baleares).
  - `data/prov/XX.json`: las gasolineras de cada provincia (código INE) con sus precios.
  - `data/historico.json`: medianas diarias por provincia de los últimos 120 días.
- La GitHub Action **Actualizar precios** ejecuta el script y sube los cambios. La lanza cron-job.org cada 30 minutos (con un respaldo propio cada hora). El Ministerio actualiza los precios cada media hora.
- La web (`index.html`, `app.js`, `styles.css`) es estática, la sirve GitHub Pages y se puede instalar en el móvil.

## Criterios

- **Precio típico** = mediana de las gasolineras de la provincia (no la media ni el máximo, que dependen de unas pocas estaciones).
- El color del mapa compara con la mediana de la península y Baleares, en céntimos. Canarias, Ceuta y Melilla tienen otra fiscalidad: se muestran pero no cuentan para la referencia.
- Se excluyen de las estadísticas las gasolineras de venta restringida (solo socios).
- Los combustibles se muestran con su nombre oficial (Gasolina 95 E5, Gasóleo A, Gasóleo Premium…). El Ministerio no publica los nombres comerciales de cada marca.

## Fuentes

| Datos | Fuente |
|---|---|
| Precios y gasolineras | [Geoportal de gasolineras](https://geoportalgasolineras.es/), Ministerio para la Transición Ecológica ([servicio REST](https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help)) |
| Límites de provincias | [click_that_hood](https://github.com/codeforgermany/click_that_hood) (simplificado con mapshaper) |
| Mapa base | Esri Canvas |

## Probar en local

```bash
node scripts/update.mjs
python3 -m http.server
```
