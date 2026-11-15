import { Datos, Config, montarBarra, montarPruebas, crearAlertas, graficoHistorial, toast, $,
         ITH, nivelITH, UMBRALES_ITH, fmtHora, hace, inicioDeDia, MIN, HORA } from "./nucleo.js";

Datos.iniciar('agro');
montarBarra('agro.html');
montarPruebas();

// Configuración compartida (se guarda en Firebase: /config/agro)
const cfg = Config('agro', { tipo: 0, maxMin: 30, tempMax: 35 });
const alertas = crearAlertas($('alertas'));

const ACCIONES = [
    'Condiciones de confort. Mantener el monitoreo.',
    'Alerta: asegurar agua fresca y sombra, y evitar manejar la hacienda en las horas de más calor.',
    'Peligro: activar ventilación o mojado, reducir el manejo y los trabajos con animales.',
    'Emergencia: aplicar todas las medidas de refrescado, suspender el manejo y vigilar a los animales de cerca.'
];

// ---------- Otras instalaciones (simuladas, solo en modo demo) ----------
const OTRAS = [
    { nombre: 'Tambo (leche)', dt: 0.8, dh: -3, tipo: 1 },
    { nombre: 'Corral de engorde (carne)', dt: 1.5, dh: -5, tipo: 0 },
    { nombre: 'Silo de acopio', dt: -2, dh: 6, tipo: null },
    { nombre: 'Criadero porcino', dt: 0.5, dh: 4, tipo: null }
];

function pintarInstalaciones() {
    const e = Datos.estado(), tipo = Number(cfg.valores.tipo);
    const lista = [{ nombre: 'Galpón 1', t: e.temp, h: e.hum, tipo, etiqueta: e.simulado ? 'SIMULADA' : e.vivo ? 'EN VIVO' : 'SIN SEÑAL', clase: e.simulado ? 'demo' : e.vivo ? 'vivo' : 'caido' }];
    if (Datos.demo && e.temp != null) {
        OTRAS.forEach((o) => lista.push({ nombre: o.nombre, t: e.temp + o.dt, h: Math.max(10, Math.min(98, e.hum + o.dh)), tipo: o.tipo, etiqueta: 'SIMULADA', clase: 'demo' }));
    }
    $('nota-inst').textContent = Datos.demo
        ? 'Solo el Galpón 1 tendría un nodo físico; el resto es simulado para mostrar cómo escala. El ITH aplica a bovinos: en silos y criaderos solo se muestran temperatura y humedad.'
        : 'Cada instalación necesita su propio nodo (un ESP32 con sensores). Hoy hay uno conectado.';
    $('instalaciones').innerHTML = lista.map((s) => {
        if (s.t == null) return `<div class="suc"><div class="fila"><b>${s.nombre}</b><span class="insignia ${s.clase}">${s.etiqueta}</span></div><span class="nota">Sin datos</span></div>`;
        const ith = ITH(s.t, s.h), niv = s.tipo === null ? null : nivelITH(ith, s.tipo);
        return `<div class="suc"><div class="fila"><b>${s.nombre}</b><span class="insignia ${s.clase}">${s.etiqueta}</span></div>
            <div class="fila"><span class="num">${s.t.toFixed(1)} °C</span><span>${Math.round(s.h)} %</span></div>
            <div class="fila"><span>ITH ${niv ? ith.toFixed(1) : '—'}</span><b style="color:${niv ? niv.color : 'inherit'}">${niv ? niv.texto : 'n/a'}</b></div></div>`;
    }).join('');
}

// ---------- Actualización general ----------
function actualizar() {
    const e = Datos.estado(), v = cfg.valores, tipo = Number(v.tipo), ahora = Datos.ahora(), hist = Datos.historial();
    const [a, p, em] = UMBRALES_ITH[tipo] || UMBRALES_ITH[0];

    // ITH y medidor
    const tiene = e.temp != null && e.hum != null;
    const ith = tiene ? ITH(e.temp, e.hum) : null, niv = tiene ? nivelITH(ith, tipo) : { n: 0, texto: 'Sin datos', color: '#94a3b8' };
    $('k-ith').textContent = tiene ? ith.toFixed(1) : '--';
    $('k-ith').style.color = niv.color;
    $('k-ith-sub').textContent = niv.texto;
    $('k-temp').textContent = e.temp == null ? '--' : e.temp.toFixed(1) + ' °C';
    $('k-hum').textContent = e.hum == null ? '--' : Math.round(e.hum) + ' %';
    const pos = (x) => Math.max(0, Math.min(100, (x - 60) / 35 * 100));
    $('gauge-barra').style.background = `linear-gradient(90deg,#4ade80 0 ${pos(a)}%,#facc15 ${pos(a)}% ${pos(p)}%,#fb923c ${pos(p)}% ${pos(em)}%,#ef4444 ${pos(em)}% 100%)`;
    $('gauge-marca').style.left = (tiene ? pos(ith) : 0) + '%';
    $('gauge-a').textContent = a; $('gauge-p').textContent = p; $('gauge-e').textContent = em;
    $('t-accion').textContent = ACCIONES[niv.n];
    $('t-recomendacion').textContent = `Confort bajo ${a} · Alerta desde ${a} · Peligro desde ${p} · Emergencia desde ${em}`;

    // Personas adentro y tiempo de permanencia (desde el último momento con 0 personas)
    let minutos = 0;
    if (e.personas > 0) {
        let desde = hist.length ? hist[0].ts : ahora;
        for (let i = hist.length - 1; i >= 0; i--) if (hist[i].pers === 0) { desde = hist[i].ts; break; }
        minutos = Math.max(0, (ahora - desde) / MIN);
    }
    $('k-pers').textContent = e.personas;
    $('k-pers-sub').textContent = e.personas > 0 ? 'adentro hace ' + Math.round(minutos) + ' min' : 'recinto vacío';

    // Recuperación nocturna: horas bajo 21 °C entre las 21:00 de ayer y las 07:00 de hoy
    const finNoche = inicioDeDia(ahora) + 7 * HORA, iniNoche = finNoche - 10 * HORA;
    const noche = hist.filter((r) => r.ts >= iniNoche && r.ts < Math.min(finNoche, ahora));
    $('k-noche').textContent = noche.length ? (noche.filter((r) => r.temp < 21).length / 60).toFixed(1) + ' h' : '--';

    // Bitácora de accesos
    const ult = Datos.eventos().slice(-8).reverse();
    $('bitacora').innerHTML = ult.length
        ? ult.map((x) => `<tr><td>${fmtHora(x.ts)}</td><td>${x.tipo === 'E' ? '➡️ Entrada' : '⬅️ Salida'}</td><td>${hace(ahora - x.ts)}</td></tr>`).join('')
        : '<tr><td colspan="3">Sin accesos registrados</td></tr>';

    // Alertas
    alertas.set('ith', niv.n >= 1, `ITH en ${niv.texto.toLowerCase()}: ${tiene ? ith.toFixed(1) : ''}`, niv.n >= 2 ? 'critico' : 'aviso');
    alertas.set('permanencia', e.personas > 0 && minutos > v.maxMin, `Personal adentro hace ${Math.round(minutos)} min (máximo ${v.maxMin})`, 'critico');
    alertas.set('calor-personal', e.personas > 0 && e.temp != null && e.temp > v.tempMax, `Temperatura alta con personal adentro: ${e.temp == null ? '' : e.temp.toFixed(1)} °C`, 'critico');
    alertas.set('senal', !Datos.demo && !e.vivo, 'Sensor sin señal hace más de 2 minutos', 'critico');

    pintarInstalaciones();
}

// ---------- Gráfico de historial ----------
graficoHistorial({
    canvas: $('g-hist'), botones: $('g-botones'), estado: $('g-estado'),
    series: [
        { etiqueta: 'Temperatura (°C)', eje: 'temp', color: 'hsl(32, 95%, 55%)', grosor: 2.5, valor: (r) => r.temp },
        { etiqueta: 'Humedad (%)', eje: 'hum', color: 'hsla(32, 30%, 62%, 0.6)', guion: [6, 5], valor: (r) => r.hum },
        { etiqueta: 'ITH', eje: 'ith', color: '#f472b6', valor: (r) => ITH(r.temp, r.hum) },
        { etiqueta: 'Personas', eje: 'pers', color: '#4ade80', relleno: 'rgba(74,222,128,.12)', escalon: true, agregar: 'max', valor: (r) => r.pers }
    ],
    ejes: {
        temp: { pos: 'left', color: 'hsl(32, 95%, 55%)', sufijo: ' °C', rejilla: true },
        pers: { pos: 'left', cero: true, sugMax: 3, entero: true, color: '#4ade80' },
        ith: { pos: 'right', color: '#f472b6' },
        hum: { pos: 'right', min: 0, max: 100, color: 'hsl(32, 30%, 62%)', sufijo: ' %' }
    },
    lineas: [
        { etiqueta: 'ITH alerta', eje: 'ith', color: '#facc15', valor: () => UMBRALES_ITH[Number(cfg.valores.tipo)][0] },
        { etiqueta: 'ITH peligro', eje: 'ith', color: '#fb923c', valor: () => UMBRALES_ITH[Number(cfg.valores.tipo)][1] }
    ]
});

// ---------- Configuración ----------
cfg.alCambiar((v) => { $('c-tipo').value = v.tipo; $('c-maxmin').value = v.maxMin; $('c-tempmax').value = v.tempMax; actualizar(); });
async function guardar() {
    try { await cfg.guardar({ tipo: Number($('c-tipo').value), maxMin: Number($('c-maxmin').value), tempMax: Number($('c-tempmax').value) }); toast('Configuración guardada', 'ok'); }
    catch (e) { toast('No se pudo guardar: ' + e.message, 'aviso'); }
}
$('btn-guardar').onclick = guardar;
$('c-tipo').onchange = guardar;

// ---------- Panel de pruebas (demo) ----------
$('btn-calor').onclick = () => Datos.simularCalor(9);
$('btn-normal').onclick = () => Datos.simularCalor(0);
$('btn-atrapado').onclick = () => Datos.simularPermanencia(45);
Datos.alEvento((e) => toast(e.tipo === 'E' ? '➡️ Entró alguien al recinto' : '⬅️ Salió alguien del recinto', e.tipo === 'E' ? 'ok' : 'aviso'));

Datos.alCambiar(actualizar);
actualizar();
