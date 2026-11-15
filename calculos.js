// Cálculos puros (sin Firebase ni DOM): fórmulas, estadísticas y generador de datos de demostración.
export const MIN = 60000, HORA = 3600000, DIA = 86400000;

export const pad = (n) => String(n).padStart(2, '0');
export const fmtHora = (ts) => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const inicioDeDia = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const hace = (ms) => {
  const m = Math.round(ms / MIN);
  return m < 1 ? 'recién' : m < 60 ? 'hace ' + m + ' min' : 'hace ' + Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
};
const gauss = (x, mu, s) => Math.exp(-((x - mu) ** 2) / (2 * s * s));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Fórmulas ----------

// ITH (Thom): combina temperatura (°C) y humedad relativa (%)
export const ITH = (t, h) => 0.8 * t + (h / 100) * (t - 14.3) + 46.4;

// Umbrales [alerta, peligro, emergencia]. 0 = bovinos de carne (INTA), 1 = bovinos de leche (referencia)
export const UMBRALES_ITH = [[75, 79, 84], [72, 78, 88]];
export function nivelITH(ith, tipo = 0) {
  const [a, p, e] = UMBRALES_ITH[tipo] || UMBRALES_ITH[0];
  if (ith >= e) return { n: 3, texto: 'Emergencia', color: '#ef4444' };
  if (ith >= p) return { n: 2, texto: 'Peligro', color: '#fb923c' };
  if (ith >= a) return { n: 1, texto: 'Alerta', color: '#facc15' };
  return { n: 0, texto: 'Confort', color: '#4ade80' };
}

// Sensación térmica (índice de calor de Rothfusz). Con menos de 27 °C o 40 % devuelve la temperatura.
export function sensacionTermica(tc, h) {
  if (tc < 27 || h < 40) return tc;
  const t = tc * 9 / 5 + 32;
  const hi = -42.379 + 2.04901523 * t + 10.14333127 * h - 0.22475541 * t * h - 0.00683783 * t * t
    - 0.05481717 * h * h + 0.00122874 * t * t * h + 0.00085282 * t * h * h - 0.00000199 * t * t * h * h;
  return (hi - 32) * 5 / 9;
}

// ---------- Estadísticas ----------

// Promedio y máximo de personas por hora del día (opcionalmente solo lunes a viernes)
export function ocupacionPorHora(historial, soloHabiles = false) {
  const suma = Array(24).fill(0), cant = Array(24).fill(0), max = Array(24).fill(0);
  for (const r of historial) {
    const f = new Date(r.ts), d = f.getDay();
    if (soloHabiles && (d === 0 || d === 6)) continue;
    const h = f.getHours();
    suma[h] += r.pers; cant[h]++;
    if (r.pers > max[h]) max[h] = r.pers;
  }
  return { prom: suma.map((s, i) => (cant[i] ? Math.round(s / cant[i] * 10) / 10 : 0)), max };
}

// Cantidad de ingresos por hora en el día que empieza en desdeTs
export function ingresosPorHora(eventos, desdeTs) {
  const v = Array(24).fill(0);
  for (const e of eventos) if (e.tipo === 'E' && e.ts >= desdeTs && e.ts < desdeTs + DIA) v[new Date(e.ts).getHours()]++;
  return v;
}

// Agrupa registros en intervalos (promedio, o máximo si agregar === 'max') y corta la línea cuando hay huecos
export function agruparSeries(registros, desde, bucketMs, series) {
  const grupos = new Map();
  for (const r of registros) {
    if (r.ts < desde) continue;
    const k = Math.floor(r.ts / bucketMs);
    let g = grupos.get(k);
    if (!g) { g = { n: 0, ts: 0, v: series.map(() => 0) }; grupos.set(k, g); }
    g.n++; g.ts += r.ts;
    series.forEach((s, i) => { const x = s.valor(r); g.v[i] = s.agregar === 'max' ? Math.max(g.v[i], x) : g.v[i] + x; });
  }
  const gapMs = Math.max(bucketMs * 3, 4 * MIN);
  const salida = series.map(() => []);
  let xPrev = null, cantidad = 0;
  for (const k of [...grupos.keys()].sort((a, b) => a - b)) {
    const g = grupos.get(k), x = g.ts / g.n;
    cantidad += g.n;
    if (xPrev !== null && x - xPrev > gapMs) salida.forEach((arr) => arr.push({ x: xPrev + 1, y: null }));
    series.forEach((s, i) => salida[i].push({ x, y: s.agregar === 'max' ? g.v[i] : Math.round(g.v[i] / g.n * 10) / 10 }));
    xPrev = x;
  }
  return { datos: salida, cantidad };
}

// ---------- Datos de demostración ----------

// Cada perfil dice cuánta gente suele haber según día (0 = domingo) y hora, y cómo se comporta el clima del lugar
export const PERFILES = {
  banca: {
    semilla: 11, varTemp: 1.2, kT: 0.07, kH: 0.2,
    objetivo: (d, h) => (d >= 1 && d <= 5 && h >= 8 && h < 16) ? 2 + 13 * (gauss(h, 11.5, 1.5) + 0.5 * gauss(h, 14.5, 1.1)) : 0,
    temp: (h) => 22.5 + 1.6 * gauss(h, 15, 4),
    hum: (h) => 47 - 5 * gauss(h, 15, 4)
  },
  agro: {
    semilla: 23, varTemp: 9, kT: 0.05, kH: 0.3,
    objetivo: (d, h) => (d >= 1 && d <= 6 && h >= 7 && h < 17) ? 0.5 + 2.8 * gauss(h, 9.5, 2.2) + 1.2 * gauss(h, 14.5, 1.4) : 0,
    temp: (h) => 14 + 20 * gauss(h, 15, 4.3),
    hum: (h) => 82 - 50 * gauss(h, 15, 4.3)
  },
  aforo: {
    semilla: 37, varTemp: 2, kT: 0.07, kH: 0.25,
    objetivo: (d, h) => {
      const dd = h < 6 ? (d + 6) % 7 : d, hh = h < 6 ? h + 24 : h;
      const noche = (dd === 5 || dd === 6) ? 46 : (dd === 0 ? 24 : 15);
      return noche * gauss(hh, 23, 2.4) + 9 * gauss(hh, 13, 1.3);
    },
    temp: (h) => 21 + 2.5 * gauss(h, 16, 5),
    hum: () => 44
  }
};

// Genera `dias` de historial (un punto por minuto) y eventos de entrada/salida coherentes con el perfil.
// Es determinista: con el mismo perfil siempre da el mismo pasado.
export function generarSim(nombre, hasta, dias = 7) {
  const P = PERFILES[nombre], r = mulberry32(P.semilla);
  const historial = [], eventos = [];
  let pers = 0, temp = P.temp(0), hum = P.hum(0), diaPrev = -1, off = 0;
  const desde = Math.floor((hasta - dias * DIA) / MIN) * MIN;
  for (let t = desde; t <= hasta; t += MIN) {
    const f = new Date(t), h = f.getHours() + f.getMinutes() / 60;
    const dia = Math.floor(t / DIA);
    if (dia !== diaPrev) { off = (mulberry32(P.semilla * 977 + dia)() - 0.5) * P.varTemp; diaPrev = dia; }
    const obj = P.objetivo(f.getDay(), h);
    let nuevo;
    if (obj < 0.5) nuevo = pers > 0 ? Math.max(0, pers - Math.ceil(pers / 2)) : 0;
    else nuevo = Math.max(0, Math.round(pers + 0.35 * (obj - pers) + (r() - 0.5) * (1 + obj * 0.15)));
    const dif = nuevo - pers;
    for (let i = 0; i < Math.abs(dif); i++) eventos.push({ ts: t + Math.floor(r() * MIN), tipo: dif > 0 ? 'E' : 'S' });
    if (obj > 1 && r() < 0.35) {   // alguien entra y sale dentro del mismo minuto
      eventos.push({ ts: t + Math.floor(r() * 25000), tipo: 'E' });
      eventos.push({ ts: t + 30000 + Math.floor(r() * 25000), tipo: 'S' });
    }
    pers = nuevo;
    temp += 0.25 * (P.temp(h) + off + P.kT * pers - temp) + (r() - 0.5) * 0.15;
    hum += 0.25 * (P.hum(h) - off * 1.5 + P.kH * pers - hum) + (r() - 0.5) * 0.6;
    historial.push({ ts: t, pers, temp: Math.round(temp * 10) / 10, hum: Math.max(5, Math.min(99, Math.round(hum))), sim: true });
  }
  eventos.sort((a, b) => a.ts - b.ts);
  return { historial, eventos: eventos.map((e) => ({ ...e, sim: true })), personas: pers, temp, hum };
}
