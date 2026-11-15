// Núcleo compartido por las 3 páginas: Firebase, datos en vivo, modo demo, gráficos y utilidades.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, onValue, onChildAdded, query, orderByChild, startAt, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { MIN, HORA, DIA, fmtHora, PERFILES, generarSim, agruparSeries } from "./calculos.js";
export * from "./calculos.js";

const firebaseConfig = {
    apiKey: "AIzaSyAZzTkaGXdrCMPdxyIPfw51UW-mOckATsE",
    authDomain: "proyectoporton-71256.firebaseapp.com",
    databaseURL: "https://proyectoporton-71256-default-rtdb.firebaseio.com",
    projectId: "proyectoporton-71256",
    storageBucket: "proyectoporton-71256.firebasestorage.app",
    messagingSenderId: "7141665225",
    appId: "1:7141665225:web:1cc3b2668896c247e4e018",
    measurementId: "G-C6DRTDSPS3"
};
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export const $ = (id) => document.getElementById(id);

export function toast(texto, clase = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + clase;
    el.textContent = texto;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

// ======================= DATOS (en vivo + modo demo) =======================
// Las páginas solo leen de acá: Datos.estado(), Datos.historial(), Datos.eventos().
// Modo demo: el pasado se rellena con datos simulados y, si el sensor real no está enviando, también el presente.
export const Datos = {
    demo: localStorage.getItem('demo') === '1',
    perfil: 'banca',
    offset: 0,                                   // diferencia entre el reloj de esta PC y el de Firebase
    real: { personas: 0, temp: null, hum: null, ultimoDht: 0, historial: [], eventos: [] },
    sim: { personas: 0, temp: 24, hum: 45, extraTemp: 0, historial: [], eventos: [], ultimoPunto: 0 },
    _fns: [], _fnsEvento: [], _version: 0, _cache: null, _timer: null, _listo: false,

    ahora() { return Date.now() + this.offset; },
    alCambiar(fn) { this._fns.push(fn); },
    alEvento(fn) { this._fnsEvento.push(fn); },
    _emitir() {
        this._version++;
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this._fns.forEach((f) => f()), 120);
    },

    // Valores actuales. "vivo" = el ESP32 mandó datos hace menos de 2 minutos.
    estado() {
        const vivo = this.ahora() - this.real.ultimoDht < 2 * MIN;
        if (this.demo && !vivo) return { personas: this.sim.personas, temp: this.sim.temp, hum: this.sim.hum, vivo: false, simulado: true };
        return { personas: this.real.personas, temp: this.real.temp, hum: this.real.hum, vivo, simulado: false };
    },

    _combinar() {
        if (this._cache && this._cache.v === this._version) return this._cache;
        let h = this.real.historial, e = this.real.eventos;
        if (this.demo) {   // los datos simulados solo rellenan los minutos donde no hay datos reales
            const cubiertos = new Set(this.real.historial.map((r) => Math.floor(r.ts / MIN)));
            h = this.sim.historial.filter((r) => !cubiertos.has(Math.floor(r.ts / MIN))).concat(this.real.historial);
            e = this.sim.eventos.filter((x) => !cubiertos.has(Math.floor(x.ts / MIN))).concat(this.real.eventos);
        }
        this._cache = { v: this._version, h: h.slice().sort((a, b) => a.ts - b.ts), e: e.slice().sort((a, b) => a.ts - b.ts) };
        return this._cache;
    },
    historial() { return this._combinar().h; },
    eventos() { return this._combinar().e; },

    iniciar(perfil) {
        this.perfil = perfil;
        onValue(ref(db, '.info/serverTimeOffset'), (s) => {
            this.offset = s.val() || 0;
            if (!this._listo) {
                this._listo = true;
                this._suscribir();
                if (this.demo) this._arrancarSim();
            }
        });
        onValue(ref(db, 'sensor_pir'), (s) => { this.real.personas = (s.val() || {}).personas_dentro ?? 0; this._emitir(); });
        onValue(ref(db, 'sensor_dht'), (s) => {
            const v = s.val() || {};
            this.real.temp = v.temperatura ?? null;
            this.real.hum = v.humedad ?? null;
            this.real.ultimoDht = v.actualizado ?? 0;
            this._emitir();
        });
        setInterval(() => this._emitir(), 15000);   // refresca "en vivo / sin señal"
    },

    _suscribir() {
        const desde = this.ahora() - 7 * DIA;
        onChildAdded(query(ref(db, 'historial'), orderByChild('ts'), startAt(desde)), (s) => {
            const r = s.val();
            if (r && Number.isFinite(r.ts) && Number.isFinite(r.temp)) {
                this.real.historial.push({ ts: r.ts, temp: r.temp, hum: r.hum ?? 0, pers: r.pers ?? 0 });
                this._emitir();
            }
        }, (e) => console.error('historial:', e.message));
        onChildAdded(query(ref(db, 'eventos'), orderByChild('ts'), startAt(desde)), (s) => {
            const e = s.val();
            if (e && Number.isFinite(e.ts)) {
                this.real.eventos.push({ ts: e.ts, tipo: e.tipo });
                if (e.ts > this.ahora() - 15000) this._fnsEvento.forEach((f) => f(e));
                this._emitir();
            }
        }, (e) => console.error('eventos:', e.message));
    },

    // ---- simulación ----
    _arrancarSim() {
        const g = generarSim(this.perfil, this.ahora());
        Object.assign(this.sim, { historial: g.historial, eventos: g.eventos, personas: g.personas, temp: g.temp, hum: g.hum, ultimoPunto: this.ahora() });
        this._emitir();
        setInterval(() => this._pasoSim(), 3000);
    },
    _pasoSim() {
        if (this.estado().vivo) return;   // si el sensor real está enviando, se pausa la simulación
        const P = PERFILES[this.perfil], s = this.sim, t = this.ahora(), f = new Date(t), h = f.getHours() + f.getMinutes() / 60;
        const obj = P.objetivo(f.getDay(), h);
        const quiereEntrar = obj < 0.5 ? 0 : (s.personas < obj ? 0.7 : 0.3);
        if (Math.random() < 0.3) this.simularEvento(Math.random() < quiereEntrar ? 'E' : 'S');
        s.temp += 0.04 * (P.temp(h) + s.extraTemp + P.kT * s.personas - s.temp) + (Math.random() - 0.5) * 0.08;
        s.hum += 0.04 * (P.hum(h) - s.extraTemp * 1.5 + P.kH * s.personas - s.hum) + (Math.random() - 0.5) * 0.3;
        s.hum = Math.max(8, Math.min(99, s.hum));
        if (t - s.ultimoPunto >= MIN) {
            s.historial.push({ ts: t, pers: s.personas, temp: Math.round(s.temp * 10) / 10, hum: Math.round(s.hum), sim: true });
            s.ultimoPunto = t;
        }
        this._emitir();
    },
    simularEvento(tipo) {
        const s = this.sim, t = this.ahora();
        if (tipo === 'E') s.personas++;
        else if (s.personas > 0) s.personas--;
        else return;
        s.eventos.push({ ts: t, tipo, sim: true });
        this._fnsEvento.forEach((f) => f({ ts: t, tipo }));
        this._emitir();
    },
    simularCalor(grados) {                       // "ola de calor": sube (o baja) la temperatura al instante
        const s = this.sim;
        s.temp += grados - s.extraTemp;
        s.hum = Math.max(8, s.hum - (grados - s.extraTemp) * 1.5);
        s.extraTemp = grados;
        this._emitir();
    },
    simularPermanencia(minutos) {                // hay alguien adentro desde hace `minutos`
        const s = this.sim, desde = this.ahora() - minutos * MIN;
        s.personas = Math.max(1, s.personas);
        s.historial.forEach((r) => { if (r.ts >= desde) r.pers = Math.max(1, r.pers); });
        this._emitir();
    }
};

// ======================= CONFIGURACIÓN (guardada en Firebase: /config/<nodo>) =======================
export function Config(nodo, defecto) {
    const c = { valores: { ...defecto }, _fns: [] };
    onValue(ref(db, 'config/' + nodo), (s) => {
        c.valores = { ...defecto, ...(s.val() || {}) };
        c._fns.forEach((f) => f(c.valores));
    }, () => {});
    c.alCambiar = (f) => { c._fns.push(f); f(c.valores); };
    c.guardar = (obj) => update(ref(db, 'config/' + nodo), obj);
    return c;
}

// ======================= SESIÓN (Firebase Authentication) =======================
export const Sesion = {
    usuario: null, _fns: [],
    alCambiar(fn) { this._fns.push(fn); fn(this.usuario); },
    entrar: (mail, pass) => signInWithEmailAndPassword(auth, mail, pass),
    salir: () => signOut(auth)
};
onAuthStateChanged(auth, (u) => { Sesion.usuario = u; Sesion._fns.forEach((f) => f(u)); });

export const mensajeAuth = (c) => ({
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/missing-password': 'Escribí la contraseña.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá un momento.',
    'auth/network-request-failed': 'Sin conexión a internet.',
    'auth/operation-not-allowed': 'Falta habilitar Correo/Contraseña en Firebase > Authentication.'
}[c] || 'No se pudo iniciar sesión (' + c + ').');

// ======================= SONIDO Y ALERTAS =======================
export const Sonido = {
    activo: localStorage.getItem('sonido') === '1', ctx: null,
    _ctx() {
        this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    alternar() { this.activo = !this.activo; localStorage.setItem('sonido', this.activo ? '1' : '0'); if (this.activo) this._ctx(); },
    beep(frec = 880, dur = 0.18, veces = 1) {
        if (!this.activo) return;
        try {
            this._ctx();
            for (let i = 0; i < veces; i++) {
                const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t0 = this.ctx.currentTime + i * (dur + 0.1);
                o.frequency.value = frec; g.gain.value = 0.15;
                o.connect(g); g.connect(this.ctx.destination);
                o.start(t0); o.stop(t0 + dur);
            }
        } catch (e) { /* sin audio */ }
    }
};

// Lista de alertas: set(clave, activa, texto, nivel) crea la alerta al activarse y la marca como resuelta al apagarse
export function crearAlertas(listaEl) {
    const activas = new Map(), registro = [];
    function pintar() {
        listaEl.innerHTML = registro.length
            ? registro.slice(0, 8).map((a) => `<li class="al ${a.nivel}${a.activa ? '' : ' resuelta'}"><b>${fmtHora(a.ts)}</b> ${a.texto}${a.activa ? '' : ' <em>(resuelta)</em>'}</li>`).join('')
            : '<li class="al ok">✅ Sin alertas</li>';
    }
    pintar();
    return {
        set(clave, activa, texto, nivel = 'aviso') {
            const previa = activas.get(clave);
            if (activa && !previa) {
                const a = { ts: Date.now(), texto, nivel, activa: true };
                activas.set(clave, a); registro.unshift(a);
                Sonido.beep(nivel === 'critico' ? 660 : 880, 0.2, nivel === 'critico' ? 3 : 1);
                pintar();
            } else if (activa && previa && (previa.texto !== texto || previa.nivel !== nivel)) {
                previa.texto = texto; previa.nivel = nivel; pintar();
            } else if (!activa && previa) {
                previa.activa = false; activas.delete(clave); pintar();
            }
        },
        cantidad: () => activas.size
    };
}

// ======================= BARRA SUPERIOR =======================
export function montarBarra(actual) {
    const paginas = [['banca.html', '🏦 Banca'], ['agro.html', '🌾 Agro'], ['aforo.html', '🎟️ Aforo'], ['index.html', '📟 Sensor']];
    $('barra').innerHTML = `
        <div class="barra-links">${paginas.map(([h, t]) => `<a href="${h}" class="${h === actual ? 'activo' : ''}">${t}</a>`).join('')}</div>
        <div class="barra-estado">
            <span id="estado-conexion" class="insignia">…</span>
            <label class="interruptor"><input type="checkbox" id="chk-demo" ${Datos.demo ? 'checked' : ''}> Demo</label>
            <button id="btn-sonido" class="btn chico sec" title="Sonido de alertas">${Sonido.activo ? '🔔' : '🔕'}</button>
        </div>`;
    $('chk-demo').onchange = (e) => { localStorage.setItem('demo', e.target.checked ? '1' : '0'); location.reload(); };
    $('btn-sonido').onclick = (e) => {
        Sonido.alternar();
        e.target.textContent = Sonido.activo ? '🔔' : '🔕';
        if (Sonido.activo) Sonido.beep(880, 0.1);
    };
    if (Datos.demo) document.body.insertAdjacentHTML('afterbegin', '<div class="cinta-demo">🧪 MODO DEMO · datos simulados (no son mediciones reales)</div>');
    Datos.alCambiar(() => {
        const e = Datos.estado(), el = $('estado-conexion');
        el.className = 'insignia ' + (e.simulado ? 'demo' : e.vivo ? 'vivo' : 'caido');
        el.textContent = e.simulado ? '🧪 SIMULADO' : e.vivo ? '🟢 EN VIVO' : '🔴 SIN SEÑAL';
    });
    document.addEventListener('click', () => { if (Sonido.activo) Sonido._ctx(); }, { once: true });
}

// Panel de pruebas (solo se ve en modo demo): botones data-ev="E|S" data-n="cantidad"
export function montarPruebas() {
    const p = $('panel-pruebas');
    if (!p) return;
    p.classList.toggle('oculto', !Datos.demo);
    p.querySelectorAll('[data-ev]').forEach((b) => {
        b.onclick = () => {
            if (!Datos.estado().simulado) return toast('El sensor real está enviando datos: la simulación está en pausa', 'aviso');
            for (let i = 0; i < Number(b.dataset.n); i++) Datos.simularEvento(b.dataset.ev);
        };
    });
}

// ======================= GRÁFICOS (Chart.js) =======================
export const PERIODOS = [['30 min', 30 * MIN], ['1 h', HORA], ['2 h', 2 * HORA], ['6 h', 6 * HORA],
    ['12 h', 12 * HORA], ['1 día', DIA], ['3 días', 3 * DIA], ['1 semana', 7 * DIA]];

let chartListo = false;
function prepararChart() {
    if (typeof Chart === 'undefined') return false;
    if (!chartListo) {
        Chart.defaults.color = '#94a3b8';
        Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.12)';
        Chart.defaults.font.family = 'Outfit, sans-serif';
        chartListo = true;
    }
    return true;
}

// Gráfico de líneas con selector de período. series: [{etiqueta, eje, color, valor(reg), relleno, escalon, guion, agregar}]
export function graficoHistorial({ canvas, botones, estado, series, ejes, lineas = [], periodo = 1 }) {
    const vacio = { actualizar() {} };
    if (!prepararChart()) { estado.textContent = 'No se pudo cargar la librería del gráfico (¿hay internet?).'; return vacio; }
    let idx = periodo, g;
    const conjuntos = series.map((s) => ({
        label: s.etiqueta, yAxisID: s.eje, data: [], borderColor: s.color, backgroundColor: s.relleno || s.color,
        fill: !!s.relleno, stepped: s.escalon ? 'after' : false, borderDash: s.guion || [], borderWidth: s.grosor || 2,
        tension: s.escalon ? 0 : 0.35, pointRadius: 0, pointHoverRadius: 4
    })).concat(lineas.map((l) => ({
        label: l.etiqueta, yAxisID: l.eje, data: [], borderColor: l.color, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false
    })));
    const escalas = { x: { type: 'time', time: { tooltipFormat: 'dd/MM HH:mm', displayFormats: { minute: 'HH:mm', hour: 'HH:mm', day: 'dd/MM' } }, ticks: { maxRotation: 0, autoSkipPadding: 24 } } };
    for (const [id, e] of Object.entries(ejes)) {
        escalas[id] = {
            position: e.pos, display: 'auto', beginAtZero: !!e.cero, min: e.min, max: e.max, suggestedMax: e.sugMax,
            grid: { drawOnChartArea: !!e.rejilla },
            ticks: { color: e.color, precision: e.entero ? 0 : undefined, callback: (v) => v + (e.sufijo || '') }
        };
    }
    try {
        g = new Chart(canvas, {
            type: 'line', data: { datasets: conjuntos },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { boxWidth: 28, boxHeight: 3 } }, tooltip: { filter: (i) => i.parsed.y !== null } },
                scales: escalas
            }
        });
    } catch (e) { estado.textContent = 'No se pudo dibujar el gráfico: ' + e.message; return vacio; }

    function marcar() { [...botones.children].forEach((b, i) => { b.className = 'chip' + (i === idx ? ' activo' : ''); }); }
    function actualizar() {
        const ahora = Datos.ahora(), ms = PERIODOS[idx][1], desde = ahora - ms;
        const { datos, cantidad } = agruparSeries(Datos.historial(), desde, Math.max(MIN, ms / 400), series);
        datos.forEach((d, i) => { g.data.datasets[i].data = d; });
        lineas.forEach((l, i) => {
            const y = typeof l.valor === 'function' ? l.valor() : l.valor;
            g.data.datasets[series.length + i].data = [{ x: desde, y }, { x: ahora, y }];
        });
        g.options.scales.x.min = desde;
        g.options.scales.x.max = ahora;
        g.update();
        estado.textContent = cantidad ? cantidad + ' registros en este período · se actualiza solo' : 'Todavía no hay datos en este período.';
    }
    PERIODOS.forEach(([et], i) => {
        const b = document.createElement('button');
        b.textContent = et;
        b.onclick = () => { idx = i; marcar(); actualizar(); };
        botones.appendChild(b);
    });
    marcar();
    Datos.alCambiar(actualizar);
    setInterval(actualizar, 30000);
    return { actualizar };
}

// Gráfico de barras (y líneas): poner(etiquetas, datasets)
export function graficoBarras(canvas) {
    if (!prepararChart()) return { poner() {} };
    let g;
    try {
        g = new Chart(canvas, {
            type: 'bar', data: { labels: [], datasets: [] },
            options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { boxWidth: 14 } } }, scales: { y: { beginAtZero: true } } }
        });
    } catch (e) { return { poner() {} }; }
    return { poner(etiquetas, datasets) { g.data.labels = etiquetas; g.data.datasets = datasets; g.update(); } };
}
