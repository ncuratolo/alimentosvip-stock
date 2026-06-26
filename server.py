import os
import json
import threading
import base64
import hmac
import traceback
import datetime
import psycopg2
import psycopg2.extras
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

DATABASE_URL = os.environ["DATABASE_URL"]
AUTH_USER = os.environ.get("AUTH_USER", "alimentosvip")
AUTH_PASS = os.environ.get("AUTH_PASS", "AlimentosVip+")

VIDA_UTIL_DIAS = 90

db_lock = threading.Lock()


def get_conn():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return conn


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS productos (
            id SERIAL PRIMARY KEY,
            nombre TEXT NOT NULL UNIQUE,
            unidad TEXT NOT NULL DEFAULT 'unidades',
            stock DOUBLE PRECISION NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS lotes (
            id SERIAL PRIMARY KEY,
            producto_id INTEGER NOT NULL REFERENCES productos(id),
            cantidad DOUBLE PRECISION NOT NULL,
            fecha_produccion DATE NOT NULL,
            fecha_creacion TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
        );

        CREATE TABLE IF NOT EXISTS movimientos (
            id SERIAL PRIMARY KEY,
            producto_id INTEGER NOT NULL REFERENCES productos(id),
            tipo TEXT NOT NULL CHECK (tipo IN ('produccion', 'venta', 'ajuste')),
            cantidad DOUBLE PRECISION NOT NULL,
            nota TEXT,
            fecha_produccion TEXT,
            fecha TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
        );
        """
    )
    cur.execute(
        "ALTER TABLE movimientos ALTER COLUMN fecha SET DEFAULT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')"
    )
    cur.execute(
        "ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS lote_id INTEGER REFERENCES lotes(id)"
    )
    conn.commit()
    cur.close()
    conn.close()


def row_to_dict(row):
    return dict(row)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, message, status=400):
        self._send_json({"error": message}, status)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"
        file_path = (STATIC_DIR / path.lstrip("/")).resolve()
        if STATIC_DIR not in file_path.parents and file_path != STATIC_DIR:
            self.send_response(404)
            self.end_headers()
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_response(404)
            self.end_headers()
            return
        content_types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".svg": "image/svg+xml",
        }
        ctype = content_types.get(file_path.suffix, "application/octet-stream")
        data = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        pass

    def _check_auth(self):
        header = self.headers.get("Authorization", "")
        expected = "Basic " + base64.b64encode(
            f"{AUTH_USER}:{AUTH_PASS}".encode("utf-8")
        ).decode("utf-8")
        if not hmac.compare_digest(header, expected):
            body = b"Autenticacion requerida"
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Stock Alimentos VIP"')
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return False
        return True

    def do_GET(self):
        try:
            if not self._check_auth():
                return
            parsed = urlparse(self.path)
            if parsed.path == "/api/productos":
                return self.handle_get_productos()
            if parsed.path == "/api/movimientos":
                return self.handle_get_movimientos(parse_qs(parsed.query))
            if parsed.path == "/api/lotes":
                return self.handle_get_lotes(parse_qs(parsed.query))
            return self._serve_static(parsed.path)
        except Exception as e:
            traceback.print_exc()
            return self._send_error_json(f"Error interno: {e}", 500)

    def do_POST(self):
        try:
            if not self._check_auth():
                return
            parsed = urlparse(self.path)
            try:
                body = self._read_json_body()
            except Exception:
                return self._send_error_json("JSON invalido")

            if parsed.path == "/api/productos":
                return self.handle_create_producto(body)
            if parsed.path == "/api/movimientos":
                return self.handle_create_movimiento(body)
            return self._send_error_json("No encontrado", 404)
        except Exception as e:
            traceback.print_exc()
            return self._send_error_json(f"Error interno: {e}", 500)

    def do_DELETE(self):
        try:
            if not self._check_auth():
                return
            parsed = urlparse(self.path)
            parts = parsed.path.strip("/").split("/")
            if len(parts) == 3 and parts[0] == "api" and parts[1] == "productos":
                return self.handle_delete_producto(parts[2])
            return self._send_error_json("No encontrado", 404)
        except Exception as e:
            traceback.print_exc()
            return self._send_error_json(f"Error interno: {e}", 500)

    # ---- handlers ----

    def handle_get_productos(self):
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM productos ORDER BY nombre")
        rows = cur.fetchall()
        cur.close()
        conn.close()
        self._send_json([row_to_dict(r) for r in rows])

    def handle_create_producto(self, body):
        nombre = (body.get("nombre") or "").strip()
        unidad = (body.get("unidad") or "unidades").strip()
        stock_inicial = body.get("stock_inicial", 0)
        if not nombre:
            return self._send_error_json("El nombre del producto es obligatorio")
        try:
            stock_inicial = float(stock_inicial)
        except (TypeError, ValueError):
            return self._send_error_json("Stock inicial invalido")

        with db_lock:
            conn = get_conn()
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM productos WHERE nombre = %s", (nombre,))
            if cur.fetchone():
                cur.close()
                conn.close()
                return self._send_error_json("Ya existe un producto con ese nombre")
            cur.execute(
                "INSERT INTO productos (nombre, unidad, stock) VALUES (%s, %s, %s) RETURNING *",
                (nombre, unidad, stock_inicial),
            )
            row = cur.fetchone()
            conn.commit()
            cur.close()
            conn.close()
        self._send_json(row_to_dict(row), 201)

    def handle_delete_producto(self, producto_id):
        with db_lock:
            conn = get_conn()
            cur = conn.cursor()
            cur.execute("DELETE FROM movimientos WHERE producto_id = %s", (producto_id,))
            cur.execute("DELETE FROM lotes WHERE producto_id = %s", (producto_id,))
            cur.execute("DELETE FROM productos WHERE id = %s", (producto_id,))
            conn.commit()
            cur.close()
            conn.close()
        self._send_json({"ok": True})

    def handle_get_lotes(self, query):
        producto_id = query.get("producto_id", [None])[0]
        if not producto_id:
            return self._send_error_json("Falta producto_id")
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            """SELECT * FROM lotes
               WHERE producto_id = %s AND cantidad > 0
               ORDER BY fecha_produccion ASC, id ASC""",
            (producto_id,),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        hoy = datetime.date.today()
        lotes = []
        for r in rows:
            d = row_to_dict(r)
            dias_transcurridos = (hoy - d["fecha_produccion"]).days
            d["dias_para_vencer"] = VIDA_UTIL_DIAS - dias_transcurridos
            lotes.append(d)
        self._send_json(lotes)

    def handle_get_movimientos(self, query):
        producto_id = query.get("producto_id", [None])[0]
        conn = get_conn()
        cur = conn.cursor()
        if producto_id:
            cur.execute(
                """SELECT m.*, p.nombre as producto_nombre, p.unidad as producto_unidad
                   FROM movimientos m JOIN productos p ON p.id = m.producto_id
                   WHERE m.producto_id = %s
                   ORDER BY m.id DESC LIMIT 200""",
                (producto_id,),
            )
        else:
            cur.execute(
                """SELECT m.*, p.nombre as producto_nombre, p.unidad as producto_unidad
                   FROM movimientos m JOIN productos p ON p.id = m.producto_id
                   ORDER BY m.id DESC LIMIT 200"""
            )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        self._send_json([row_to_dict(r) for r in rows])

    def handle_create_movimiento(self, body):
        try:
            producto_id = int(body.get("producto_id"))
            cantidad = float(body.get("cantidad"))
        except (TypeError, ValueError):
            return self._send_error_json("Datos invalidos")
        tipo = body.get("tipo")
        nota = (body.get("nota") or "").strip()
        fecha_produccion = (body.get("fecha_produccion") or "").strip()
        lote_id = body.get("lote_id")

        if tipo not in ("produccion", "venta", "ajuste"):
            return self._send_error_json("Tipo de movimiento invalido")
        if cantidad <= 0 and tipo != "ajuste":
            return self._send_error_json("La cantidad debe ser mayor a cero")
        if tipo == "produccion" and not fecha_produccion:
            return self._send_error_json("La fecha de producción es obligatoria")
        if tipo == "venta" and not nota:
            return self._send_error_json("Indicá cliente o motivo de la baja")
        if tipo == "venta" and not lote_id:
            return self._send_error_json("Elegí de qué partida descontar")

        with db_lock:
            conn = get_conn()
            cur = conn.cursor()
            cur.execute("SELECT * FROM productos WHERE id = %s", (producto_id,))
            producto = cur.fetchone()
            if producto is None:
                cur.close()
                conn.close()
                return self._send_error_json("Producto no encontrado", 404)

            if tipo == "produccion":
                cur.execute(
                    "INSERT INTO lotes (producto_id, cantidad, fecha_produccion) VALUES (%s, %s, %s) RETURNING id",
                    (producto_id, cantidad, fecha_produccion),
                )
                lote_id = cur.fetchone()["id"]
                nuevo_stock = producto["stock"] + cantidad
                delta_mov = cantidad

            elif tipo == "venta":
                cur.execute(
                    "SELECT * FROM lotes WHERE id = %s AND producto_id = %s", (lote_id, producto_id)
                )
                lote = cur.fetchone()
                if lote is None:
                    cur.close()
                    conn.close()
                    return self._send_error_json("Partida no encontrada", 404)
                if cantidad > lote["cantidad"]:
                    cur.close()
                    conn.close()
                    return self._send_error_json(
                        f"Esa partida solo tiene {lote['cantidad']} {producto['unidad']} disponibles"
                    )
                cur.execute(
                    "UPDATE lotes SET cantidad = cantidad - %s WHERE id = %s", (cantidad, lote_id)
                )
                nuevo_stock = producto["stock"] - cantidad
                delta_mov = -cantidad
                fecha_produccion = None

            else:  # ajuste
                nuevo_stock = producto["stock"] + cantidad
                delta_mov = cantidad
                fecha_produccion = None
                lote_id = None

            if nuevo_stock < 0:
                cur.close()
                conn.close()
                return self._send_error_json(
                    f"Stock insuficiente: hay {producto['stock']} {producto['unidad']} de {producto['nombre']}"
                )

            cur.execute(
                "UPDATE productos SET stock = %s WHERE id = %s", (nuevo_stock, producto_id)
            )
            cur.execute(
                "INSERT INTO movimientos (producto_id, tipo, cantidad, nota, fecha_produccion, lote_id) VALUES (%s, %s, %s, %s, %s, %s)",
                (producto_id, tipo, delta_mov, nota, fecha_produccion, lote_id),
            )
            cur.execute("SELECT * FROM productos WHERE id = %s", (producto_id,))
            row = cur.fetchone()
            conn.commit()
            cur.close()
            conn.close()
        self._send_json(row_to_dict(row), 201)


def main():
    init_db()
    port = int(os.environ.get("PORT", 8765))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Tablero de stock Alimentos VIP corriendo en el puerto {port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
