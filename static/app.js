const tbodyProductos = document.querySelector("#tabla-productos tbody");
const tbodyMovimientos = document.querySelector("#tabla-movimientos");
const buscador = document.querySelector("#buscador");
const toast = document.querySelector("#toast");

let productosCache = [];
const lotesCache = {};
const expandido = new Set();

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.target).classList.add("active");
  });
});

function showToast(message, isError = false) {
  const div = document.createElement("div");
  div.className = "toast-item" + (isError ? " error" : "");
  div.textContent = message;
  toast.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Error desconocido");
  return data;
}

async function cargarProductos() {
  productosCache = await api("/api/productos");
  await Promise.all(
    [...expandido].map((id) => cargarLotes(id))
  );
  renderProductos();
}

async function cargarLotes(producto_id) {
  lotesCache[producto_id] = await api(`/api/lotes?producto_id=${producto_id}`);
}

async function cargarMovimientos() {
  const movs = await api("/api/movimientos");
  tbodyMovimientos.innerHTML = movs
    .map((m) => {
      const cantidadAbs = Math.abs(m.cantidad);
      const signo = m.cantidad >= 0 ? "+" : "-";
      const detalle =
        m.tipo === "produccion"
          ? `Producido: ${m.fecha_produccion || "-"}`
          : m.nota || "";
      return `<tr>
        <td>${m.fecha}</td>
        <td>${m.producto_nombre}</td>
        <td class="tipo-${m.tipo}">${m.tipo}</td>
        <td>${signo}${cantidadAbs} ${m.producto_unidad}</td>
        <td>${detalle}</td>
      </tr>`;
    })
    .join("");
}

function badgeVencimiento(dias) {
  if (dias < 0) return `<span class="venc-badge venc-rojo">VENCIDO</span>`;
  if (dias <= 15) return `<span class="venc-badge venc-rojo">${dias} días</span>`;
  if (dias <= 30) return `<span class="venc-badge venc-amarillo">${dias} días</span>`;
  return `<span class="venc-badge venc-verde">${dias} días</span>`;
}

function renderPartidas(producto) {
  const lotes = lotesCache[producto.id];
  if (!lotes) {
    return `<tr class="fila-partidas"><td colspan="5">Cargando partidas...</td></tr>`;
  }
  if (lotes.length === 0) {
    return `<tr class="fila-partidas"><td colspan="5">No hay partidas con stock para este producto.</td></tr>`;
  }
  const filas = lotes
    .map(
      (l) => `<tr data-lote-id="${l.id}">
        <td>${l.cantidad} ${producto.unidad}</td>
        <td>${l.fecha_produccion}</td>
        <td>${badgeVencimiento(l.dias_para_vencer)}</td>
        <td>
          <div class="mov-controls">
            <input type="number" min="0" max="${l.cantidad}" step="any" value="1" class="cantidad-lote-input">
            <button class="btn-mini btn-venta" data-lote-id="${l.id}" data-producto-id="${producto.id}">− Venta</button>
          </div>
        </td>
      </tr>`
    )
    .join("");
  return `<tr class="fila-partidas"><td colspan="5">
    <table class="tabla-partidas">
      <thead><tr><th>Cantidad</th><th>Fecha producción</th><th>Vence en</th><th>Vender de esta partida</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  </td></tr>`;
}

function renderProductos() {
  const valoresActuales = {};
  tbodyProductos.querySelectorAll("tr[data-id]").forEach((fila) => {
    const input = fila.querySelector(".cantidad-input");
    if (input) valoresActuales[fila.dataset.id] = input.value;
  });

  const filtro = buscador.value.trim().toLowerCase();
  const lista = productosCache.filter((p) =>
    p.nombre.toLowerCase().includes(filtro)
  );

  const elementoActivo = document.activeElement;
  const idFilaActiva = elementoActivo?.classList?.contains("cantidad-input")
    ? elementoActivo.closest("tr")?.dataset.id
    : null;
  const posicionCursor = idFilaActiva ? elementoActivo.selectionStart : null;

  tbodyProductos.innerHTML = lista
    .map((p) => {
      const bajo = p.stock <= 5;
      const valorCantidad = valoresActuales[p.id] ?? "1";
      const abierta = expandido.has(String(p.id));
      const filaPrincipal = `<tr data-id="${p.id}">
        <td>${p.nombre}</td>
        <td><span class="stock-badge ${bajo ? "bajo" : ""}">${p.stock}</span></td>
        <td>${p.unidad}</td>
        <td>
          <div class="mov-controls">
            <input type="number" min="0" max="999" step="any" value="${valorCantidad}" class="cantidad-input">
            <button class="btn-mini btn-produccion" data-tipo="produccion">+ Producción</button>
            <button class="btn-mini btn-partidas" data-accion="partidas">${abierta ? "▾" : "▸"} Partidas</button>
          </div>
        </td>
        <td><button class="btn-mini btn-eliminar" data-accion="eliminar">Eliminar</button></td>
      </tr>`;
      return filaPrincipal + (abierta ? renderPartidas(p) : "");
    })
    .join("");

  if (idFilaActiva) {
    const nuevoInput = tbodyProductos.querySelector(
      `tr[data-id="${idFilaActiva}"] .cantidad-input`
    );
    if (nuevoInput) {
      nuevoInput.focus();
      nuevoInput.setSelectionRange(posicionCursor, posicionCursor);
    }
  }
}

document.querySelector("#form-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nombre = document.querySelector("#nombre").value;
  const unidad = document.querySelector("#unidad").value || "unidades";
  const stock_inicial = document.querySelector("#stock_inicial").value || 0;

  try {
    await api("/api/productos", {
      method: "POST",
      body: JSON.stringify({ nombre, unidad, stock_inicial }),
    });
    showToast(`Producto "${nombre}" agregado`);
    e.target.reset();
    document.querySelector("#unidad").value = "unidades";
    document.querySelector("#stock_inicial").value = 0;
    await cargarProductos();
  } catch (err) {
    showToast(err.message, true);
  }
});

tbodyProductos.addEventListener("click", async (e) => {
  // Venta desde una partida especifica
  if (e.target.dataset.loteId && e.target.classList.contains("btn-venta")) {
    const lote_id = e.target.dataset.loteId;
    const producto_id = e.target.dataset.productoId;
    const filaLote = e.target.closest("tr");
    const cantidadInput = filaLote.querySelector(".cantidad-lote-input");
    const cantidad = parseFloat(cantidadInput.value);
    if (!cantidad || cantidad <= 0) {
      showToast("Ingresá una cantidad válida", true);
      return;
    }
    const nota = prompt("Cliente o motivo de la baja:");
    if (!nota || !nota.trim()) {
      showToast("Tenés que indicar cliente o motivo", true);
      return;
    }
    try {
      await api("/api/movimientos", {
        method: "POST",
        body: JSON.stringify({ producto_id, tipo: "venta", cantidad, lote_id, nota: nota.trim() }),
      });
      showToast(`-${cantidad} vendidas de esa partida`);
      await cargarLotes(producto_id);
      await Promise.all([cargarProductos(), cargarMovimientos()]);
    } catch (err) {
      showToast(err.message, true);
    }
    return;
  }

  const fila = e.target.closest("tr[data-id]");
  if (!fila) return;
  const producto_id = fila.dataset.id;

  if (e.target.dataset.accion === "eliminar") {
    if (!confirm("¿Eliminar este producto y su historial?")) return;
    await api(`/api/productos/${producto_id}`, { method: "DELETE" });
    showToast("Producto eliminado");
    await Promise.all([cargarProductos(), cargarMovimientos()]);
    return;
  }

  if (e.target.dataset.accion === "partidas") {
    if (expandido.has(producto_id)) {
      expandido.delete(producto_id);
      renderProductos();
    } else {
      expandido.add(producto_id);
      await cargarLotes(producto_id);
      renderProductos();
    }
    return;
  }

  const tipo = e.target.dataset.tipo;
  if (tipo !== "produccion") return;

  const cantidadInput = fila.querySelector(".cantidad-input");
  const cantidad = parseFloat(cantidadInput.value);
  if (!cantidad || cantidad <= 0) {
    showToast("Ingresá una cantidad válida", true);
    return;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const fecha_produccion = prompt("Fecha de producción (AAAA-MM-DD):", hoy);
  if (!fecha_produccion) return;

  try {
    await api("/api/movimientos", {
      method: "POST",
      body: JSON.stringify({ producto_id, tipo: "produccion", cantidad, fecha_produccion }),
    });
    showToast(`+${cantidad} agregadas (nueva partida)`);
    if (expandido.has(producto_id)) await cargarLotes(producto_id);
    await Promise.all([cargarProductos(), cargarMovimientos()]);
  } catch (err) {
    showToast(err.message, true);
  }
});

buscador.addEventListener("input", renderProductos);

async function refrescarTodo() {
  try {
    await Promise.all([cargarProductos(), cargarMovimientos()]);
  } catch (err) {
    console.error(err);
  }
}

refrescarTodo();
setInterval(refrescarTodo, 4000);
