import { Datos, Config, montarBarra, montarPruebas, crearAlertas, graficoHistorial, graficoBarras, Sonido, toast, $,
         ingresosPorHora, sensacionTermica, inicioDeDia, fmtHora, pad, MIN } from "./nucleo.js";

Datos.iniciar('aforo');
montarBarra('aforo.html');
montarPruebas();

// Aforo máximo guardado en Firebase (/config/aforo)
const cfg = Config('aforo', { maximo: 50 });
const alertas = crearAlertas($('alertas'));
const grafFlujo = graficoBarras($('g-flujo'));
let sonando = null;

// Semáforo: [color, título, indicación]
function nivelAforo(pct) {
    if (pct >= 100) return ['rojo', 'AFORO COMPLETO', 'Detener el ingreso'];
    if (pct >= 90) return ['naranja', 'Casi completo', 'Dejar entrar de a uno cuando salga alguien'];
    if (pct >= 70) return ['amarillo', 'Se está llenando', 'Atención al ingreso'];
    return ['verde', 'Ingreso libre', 'Hay lugar para todos'];
}

function actualizar() {
    const e = Datos.estado(), max = cfg.valores.maximo, ahora = Datos.ahora(), hoy = inicioDeDia(ahora);
    const pct = max ? e.personas / max * 100 : 0, libres = Math.max(0, max - e.personas);
    const [color, titulo, indicacion] = nivelAforo(pct);
    const hist = Datos.historial(), evs = Datos.eventos();

    // Semáforo principal
    $('hero').dataset.nivel = color;
    $('h-num').textContent = e.personas;
    $('h-max').textContent = max;
    $('h-libres').textContent = libres;
    $('h-pct').textContent = Math.round(pct) + '%';
    $('h-estado').textContent = titulo;
    $('h-sub').textContent = indicacion;
    $('h-barra').className = color;
    $('h-barra').style.width = Math.min(100, pct) + '%';

    // Predicción: ritmo de los últimos 15 minutos
    const neto = evs.filter((x) => x.ts > ahora - 15 * MIN).reduce((s, x) => s + (x.tipo === 'E' ? 1 : -1), 0);
    $('h-pred').textContent = libres === 0 ? 'El local está completo.'
        : neto > 0 ? `Al ritmo actual (+${neto} en 15 min) se completa en unos ${Math.max(1, Math.round(libres / (neto / 15)))} min (estimación).`
        : 'Flujo estable o decreciente: no hay riesgo de completarse pronto.';

    // Alarma al llegar al límite
    const completo = pct >= 100;
    $('banner-completo').classList.toggle('oculto', !completo);
    if (completo && !sonando) {
        Sonido.beep(660, 0.25, 3);
        sonando = setInterval(() => { Sonido.beep(660, 0.25, 3); if (navigator.vibrate) navigator.vibrate([300, 150, 300]); }, 4000);
    } else if (!completo && sonando) {
        clearInterval(sonando);
        sonando = null;
    }

    // KPIs del día
    const deHoy = evs.filter((x) => x.ts >= hoy);
    $('k-ingresos').textContent = deHoy.filter((x) => x.tipo === 'E').length;
    $('k-salidas').textContent = deHoy.filter((x) => x.tipo === 'S').length;
    let pico = { pers: 0, ts: 0 }, minCompleto = 0;
    hist.forEach((r) => {
        if (r.ts < hoy) return;
        if (r.pers > pico.pers) pico = r;
        if (max && r.pers >= max) minCompleto++;
    });
    $('k-pico').textContent = pico.pers;
    $('k-pico-sub').textContent = pico.pers ? 'a las ' + fmtHora(pico.ts) : 'sin movimiento hoy';
    $('k-completo').textContent = minCompleto;

    // Ingresos por hora
    const etiquetas = Array.from({ length: 24 }, (_, h) => pad(h) + ':00');
    grafFlujo.poner(etiquetas, [{ label: 'Ingresos', data: ingresosPorHora(evs, hoy), backgroundColor: 'rgba(232,121,249,.6)', borderRadius: 6 }]);

    // Confort
    const t = e.temp, h = e.hum;
    $('k-temp').textContent = t == null ? '--' : t.toFixed(1) + ' °C';
    $('k-hum').textContent = h == null ? '--' : Math.round(h) + ' %';
    $('k-sens').textContent = t == null || h == null ? '--' : sensacionTermica(t, h).toFixed(1) + ' °C';
    $('t-confort').textContent = t != null && t > 27 && pct > 70
        ? 'El salón se está calentando con tanta gente: conviene ventilar o bajar la temperatura.'
        : 'Ambiente cómodo.';

    // Alertas
    alertas.set('completo', completo, `Aforo completo: ${e.personas} de ${max} personas`, 'critico');
    alertas.set('cerca', pct >= 90 && !completo, `Cerca del límite: ${Math.round(pct)}% del aforo`, 'aviso');
    alertas.set('calor', t != null && t > 27 && pct > 70, `Salón caluroso (${t == null ? '' : t.toFixed(1)} °C) con ${Math.round(pct)}% de ocupación`, 'aviso');
    alertas.set('senal', !Datos.demo && !e.vivo, 'Sensor sin señal hace más de 2 minutos', 'critico');
}

// ---------- Gráfico de historial (con línea del aforo máximo) ----------
graficoHistorial({
    canvas: $('g-hist'), botones: $('g-botones'), estado: $('g-estado'),
    series: [
        { etiqueta: 'Personas', eje: 'pers', color: '#e879f9', relleno: 'rgba(232,121,249,.14)', escalon: true, agregar: 'max', valor: (r) => r.pers },
        { etiqueta: 'Temperatura (°C)', eje: 'temp', color: 'hsl(32, 95%, 55%)', grosor: 2.5, valor: (r) => r.temp },
        { etiqueta: 'Humedad (%)', eje: 'hum', color: 'hsla(32, 30%, 62%, 0.6)', guion: [6, 5], valor: (r) => r.hum }
    ],
    ejes: {
        pers: { pos: 'left', cero: true, sugMax: 10, entero: true, color: '#e879f9', rejilla: true },
        temp: { pos: 'right', color: 'hsl(32, 95%, 55%)', sufijo: ' °C' },
        hum: { pos: 'right', min: 0, max: 100, color: 'hsl(32, 30%, 62%)', sufijo: ' %' }
    },
    lineas: [{ etiqueta: 'Aforo máximo', eje: 'pers', color: '#ef4444', valor: () => cfg.valores.maximo }]
});

// ---------- Configuración ----------
cfg.alCambiar((v) => { $('c-max').value = v.maximo; actualizar(); });
$('btn-guardar').onclick = async () => {
    const n = Number($('c-max').value);
    if (!(n >= 1)) return toast('Escribí un aforo válido', 'aviso');
    try { await cfg.guardar({ maximo: n }); toast('Aforo máximo guardado', 'ok'); }
    catch (e) { toast('No se pudo guardar: ' + e.message, 'aviso'); }
};

// ---------- Pantalla de ingreso (para un televisor en la puerta) ----------
function salirPantalla() {
    document.body.classList.remove('modo-pantalla');
    $('btn-salir-pantalla').classList.add('oculto');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
}
$('btn-pantalla').onclick = () => {
    document.body.classList.add('modo-pantalla');
    $('btn-salir-pantalla').classList.remove('oculto');
    if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
};
$('btn-salir-pantalla').onclick = salirPantalla;
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) salirPantalla(); });

Datos.alEvento((e) => toast(e.tipo === 'E' ? '➡️ Entró alguien' : '⬅️ Salió alguien', e.tipo === 'E' ? 'ok' : 'aviso'));
Datos.alCambiar(actualizar);
actualizar();
