const tbodyProductos = document.querySelector("#tabla-productos tbody");
const tbodyMovimientos = document.querySelector("#tabla-movimientos");
const buscador = document.querySelector("#buscador");
const toast = document.querySelector("#toast");

let productosCache = [];

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
  renderProductos();
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

function renderProductos() {
  const valoresActuales = {};
  tbodyProductos.querySelectorAll("tr").forEach((fila) => {
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
      return `<tr data-id="${p.id}">
        <td>${p.nombre}</td>
        <td><span class="stock-badge ${bajo ? "bajo" : ""}">${p.stock}</span></td>
        <td>${p.unidad}</td>
        <td>
          <div class="mov-controls">
            <input type="number" min="0" max="999" step="any" value="${valorCantidad}" class="cantidad-input">
            <button class="btn-mini btn-produccion" data-tipo="produccion">+ Producción</button>
            <button class="btn-mini btn-venta" data-tipo="venta">− Venta</button>
          </div>
        </td>
        <td><button class="btn-mini btn-eliminar" data-accion="eliminar">Eliminar</button></td>
      </tr>`;
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
  const fila = e.target.closest("tr");
  if (!fila) return;
  const producto_id = fila.dataset.id;

  if (e.target.dataset.accion === "eliminar") {
    if (!confirm("¿Eliminar este producto y su historial?")) return;
    await api(`/api/productos/${producto_id}`, { method: "DELETE" });
    showToast("Producto eliminado");
    await Promise.all([cargarProductos(), cargarMovimientos()]);
    return;
  }

  const tipo = e.target.dataset.tipo;
  if (!tipo) return;

  const cantidadInput = fila.querySelector(".cantidad-input");
  const cantidad = parseFloat(cantidadInput.value);
  if (!cantidad || cantidad <= 0) {
    showToast("Ingresá una cantidad válida", true);
    return;
  }

  const payload = { producto_id, tipo, cantidad };

  if (tipo === "produccion") {
    const hoy = new Date().toISOString().slice(0, 10);
    const fecha_produccion = prompt("Fecha de producción (AAAA-MM-DD):", hoy);
    if (!fecha_produccion) return;
    payload.fecha_produccion = fecha_produccion;
  } else if (tipo === "venta") {
    const nota = prompt("Cliente o motivo de la baja:");
    if (!nota || !nota.trim()) {
      showToast("Tenés que indicar cliente o motivo", true);
      return;
    }
    payload.nota = nota.trim();
  }

  try {
    await api("/api/movimientos", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showToast(
      tipo === "produccion"
        ? `+${cantidad} agregadas`
        : `-${cantidad} vendidas`
    );
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
