import { Datos, Config, Sesion, mensajeAuth, montarBarra, montarPruebas, crearAlertas, graficoHistorial, graficoBarras,
         toast, $, ocupacionPorHora, inicioDeDia, fmtHora, pad, PERFILES } from "./nucleo.js";

Datos.iniciar('banca');
montarBarra('banca.html');
montarPruebas();

// Configuración compartida (se guarda en Firebase: solo la puede cambiar personal con sesión iniciada)
const cfg = Config('banca', { umbral: 15, tmin: 20, tmax: 25, apertura: 8, cierre: 16 });
const alertas = crearAlertas($('alertas'));
const grafHoras = graficoBarras($('g-horas'));

// ---------- Otras sucursales (simuladas, solo en modo demo) ----------
const OTRAS = [
    { nombre: 'General Pico', cap: 18, n: 9, t: 23.1 },
    { nombre: 'Toay', cap: 8, n: 3, t: 22.4 },
    { nombre: 'Realicó', cap: 7, n: 2, t: 24.0 },
    { nombre: 'General Acha', cap: 10, n: 4, t: 22.8 }
];
function moverOtras() {
    const f = new Date(Datos.ahora()), obj = PERFILES.banca.objetivo(f.getDay(), f.getHours() + f.getMinutes() / 60);
    OTRAS.forEach((o) => {
        const meta = Math.max(2, obj * o.cap / 15);
        o.n = Math.max(0, Math.min(Math.round(o.cap * 1.3), Math.round(o.n + 0.3 * (meta - o.n) + (Math.random() - 0.5) * 2.2)));
        o.t = Math.max(19, Math.min(28, o.t + (Math.random() - 0.5) * 0.15));
    });
}

function pintarSucursales() {
    const e = Datos.estado(), v = cfg.valores;
    const lista = [{
        nombre: 'Santa Rosa · Casa Central', n: e.personas, cap: v.umbral, t: e.temp,
        etiqueta: e.simulado ? 'SIMULADA' : e.vivo ? 'EN VIVO' : 'SIN SEÑAL', clase: e.simulado ? 'demo' : e.vivo ? 'vivo' : 'caido'
    }];
    if (Datos.demo) OTRAS.forEach((o) => lista.push({ nombre: o.nombre, n: o.n, cap: o.cap, t: o.t, etiqueta: 'SIMULADA', clase: 'demo' }));
    $('nota-red').textContent = Datos.demo
        ? 'Solo Santa Rosa tendría un nodo físico: las demás sucursales son simuladas para mostrar cómo escala el sistema.'
        : 'Cada sucursal necesita su propio nodo (un ESP32 con sensores). Hoy hay uno conectado.';
    $('sucursales').innerHTML = lista.map((s) => {
        const pct = Math.min(100, Math.round(s.n / s.cap * 100));
        const color = pct >= 100 ? 'rojo' : pct >= 70 ? 'amarillo' : 'verde';
        return `<div class="suc"><div class="fila"><b>${s.nombre}</b><span class="insignia ${s.clase}">${s.etiqueta}</span></div>
            <div class="fila"><span class="num">${s.n}</span><span>${s.t == null ? '--' : s.t.toFixed(1)} °C</span></div>
            <div class="barra-prog"><i class="${color}" style="width:${pct}%"></i></div></div>`;
    }).join('');
}

// ---------- Actualización general ----------
function actualizar() {
    const e = Datos.estado(), v = cfg.valores, ahora = Datos.ahora(), hoy = inicioDeDia(ahora);
    const hist = Datos.historial(), evs = Datos.eventos(), temp = e.temp;

    $('k-ocup').textContent = e.personas;
    $('k-ocup-sub').textContent = Math.round(e.personas / v.umbral * 100) + '% del umbral de alerta (' + v.umbral + ')';
    $('k-temp').textContent = temp == null ? '--' : temp.toFixed(1) + ' °C';
    $('k-temp-sub').textContent = temp == null ? 'sin datos'
        : temp < v.tmin ? 'Fría: bajo ' + v.tmin + ' °C' : temp > v.tmax ? 'Calurosa: sobre ' + v.tmax + ' °C' : 'Confort (' + v.tmin + ' a ' + v.tmax + ' °C)';

    let pico = { pers: 0, ts: 0 };
    hist.forEach((r) => { if (r.ts >= hoy && r.pers > pico.pers) pico = r; });
    $('k-pico').textContent = pico.pers;
    $('k-pico-sub').textContent = pico.pers ? 'a las ' + fmtHora(pico.ts) : 'sin movimiento hoy';
    $('k-visitas').textContent = evs.filter((x) => x.tipo === 'E' && x.ts >= hoy).length;

    const enHorario = hist.filter((r) => { const f = new Date(r.ts), d = f.getDay(), h = f.getHours(); return d >= 1 && d <= 5 && h >= v.apertura && h < v.cierre; });
    $('k-ahorro').textContent = enHorario.length ? Math.round(enHorario.filter((r) => r.pers <= 2).length / enHorario.length * 100) + '%' : '--';

    // Horas pico
    const { prom, max } = ocupacionPorHora(hist, true);
    const rango = [];
    for (let h = Math.max(0, v.apertura - 1); h <= Math.min(23, v.cierre); h++) rango.push(h);
    grafHoras.poner(rango.map((h) => pad(h) + ':00'), [
        { type: 'bar', label: 'Promedio de personas', data: rango.map((h) => prom[h]), backgroundColor: 'rgba(56,189,248,.55)', borderRadius: 6 },
        { type: 'line', label: 'Máximo registrado', data: rango.map((h) => max[h]), borderColor: '#f472b6', backgroundColor: '#f472b6', pointRadius: 2, tension: 0.3 }
    ]);
    const horario = [];
    for (let h = v.apertura; h < v.cierre; h++) horario.push(h);
    const maxProm = horario.length ? Math.max(...horario.map((h) => prom[h])) : 0;
    if (maxProm > 0) {
        const picos = horario.filter((h) => prom[h] >= 0.8 * maxProm);
        const valle = horario.reduce((m, h) => (prom[h] < prom[m] ? h : m), horario[0]);
        $('t-picos').textContent = `Franja pico: de ${pad(picos[0])}:00 a ${pad(picos[picos.length - 1] + 1)}:00 (hasta ${maxProm} personas en promedio). `
            + `Menor demanda: ${pad(valle)}:00 (${prom[valle]}). Sugerencia: reforzar la atención en la franja pico y bajar la climatización o reasignar personal en la de menor demanda.`;
    } else {
        $('t-picos').textContent = 'Todavía no hay datos suficientes de días hábiles.';
    }

    // Alertas
    alertas.set('ocup', e.personas >= v.umbral, `Ocupación alta: ${e.personas} personas (umbral ${v.umbral})`, 'critico');
    alertas.set('temp', temp != null && (temp < v.tmin || temp > v.tmax), `Temperatura fuera de rango: ${temp == null ? '' : temp.toFixed(1)} °C`, 'aviso');
    alertas.set('senal', !Datos.demo && !e.vivo, 'Sensor sin señal hace más de 2 minutos', 'critico');

    pintarSucursales();
}

// ---------- Gráfico de historial ----------
graficoHistorial({
    canvas: $('g-hist'), botones: $('g-botones'), estado: $('g-estado'),
    series: [
        { etiqueta: 'Personas', eje: 'pers', color: '#38bdf8', relleno: 'rgba(56,189,248,.12)', escalon: true, agregar: 'max', valor: (r) => r.pers },
        { etiqueta: 'Temperatura (°C)', eje: 'temp', color: 'hsl(32, 95%, 55%)', grosor: 2.5, valor: (r) => r.temp },
        { etiqueta: 'Humedad (%)', eje: 'hum', color: 'hsla(32, 30%, 62%, 0.6)', guion: [6, 5], valor: (r) => r.hum }
    ],
    ejes: {
        pers: { pos: 'left', cero: true, sugMax: 4, entero: true, color: '#38bdf8', rejilla: true },
        temp: { pos: 'right', color: 'hsl(32, 95%, 55%)', sufijo: ' °C' },
        hum: { pos: 'right', min: 0, max: 100, color: 'hsl(32, 30%, 62%)', sufijo: ' %' }
    },
    lineas: [{ etiqueta: 'Umbral de alerta', eje: 'pers', color: '#f87171', valor: () => cfg.valores.umbral }]
});

// ---------- Sesión (Firebase Authentication) ----------
const modal = $('modal-login');
Sesion.alCambiar((u) => {
    const caja = $('sesion');
    caja.textContent = '';
    const b = document.createElement('button');
    if (u) {
        const s = document.createElement('span');
        s.className = 'insignia vivo';
        s.textContent = '👤 ' + u.email;
        b.id = 'btn-salir'; b.className = 'btn chico sec'; b.textContent = 'Salir';
        caja.append(s, ' ', b);
    } else {
        b.id = 'btn-entrar'; b.className = 'btn'; b.textContent = '🔐 Iniciar sesión';
        caja.append(b);
    }
    $('panel-gerencia').classList.toggle('oculto', !u);
});
$('sesion').onclick = (e) => {
    if (e.target.id === 'btn-entrar') { $('login-error').textContent = ''; modal.classList.remove('oculto'); }
    if (e.target.id === 'btn-salir') Sesion.salir();
};
$('login-cancelar').onclick = () => modal.classList.add('oculto');
$('login-ok').onclick = async () => {
    try {
        await Sesion.entrar($('login-mail').value.trim(), $('login-pass').value);
        modal.classList.add('oculto');
        $('login-pass').value = '';
        toast('Sesión iniciada', 'ok');
    } catch (e) { $('login-error').textContent = mensajeAuth(e.code); }
};

// ---------- Configuración y exportación ----------
const CAMPOS = { umbral: 'c-umbral', tmin: 'c-tmin', tmax: 'c-tmax', apertura: 'c-apertura', cierre: 'c-cierre' };
cfg.alCambiar((v) => { for (const [k, id] of Object.entries(CAMPOS)) $(id).value = v[k]; actualizar(); });
$('btn-guardar').onclick = async () => {
    const datos = {};
    for (const [k, id] of Object.entries(CAMPOS)) datos[k] = Number($(id).value);
    try { await cfg.guardar(datos); toast('Configuración guardada', 'ok'); }
    catch (e) { toast('No se pudo guardar: ' + (e.code === 'PERMISSION_DENIED' ? 'iniciá sesión o revisá las reglas' : e.message), 'aviso'); }
};
$('btn-csv').onclick = () => {
    const filas = ['fecha_hora,personas,temperatura_c,humedad_pct', ...Datos.historial().map((r) => `${new Date(r.ts).toISOString()},${r.pers},${r.temp},${r.hum}`)];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([filas.join('\n')], { type: 'text/csv' }));
    a.download = 'historial_sucursal.csv';
    a.click();
};

Datos.alCambiar(actualizar);
setInterval(() => { moverOtras(); pintarSucursales(); }, 4000);
actualizar();
