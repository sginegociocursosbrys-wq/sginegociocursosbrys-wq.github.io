CREATE TABLE IF NOT EXISTS areas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) UNIQUE NOT NULL,
  tipo VARCHAR(30) NOT NULL
);
CREATE TABLE IF NOT EXISTS categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(80) UNIQUE NOT NULL,
  grupo VARCHAR(30) NOT NULL
);
CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK (rol IN ('admin','encargado','docente','auditor'))
);
CREATE SEQUENCE IF NOT EXISTS bienes_codigo_seq;
CREATE TABLE IF NOT EXISTS bienes (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE NOT NULL DEFAULT ('BM-' || lpad(nextval('bienes_codigo_seq')::text, 5, '0')),
  descripcion TEXT NOT NULL,
  categoria_id INT REFERENCES categorias(id),
  area_id INT REFERENCES areas(id),
  responsable VARCHAR(120),
  estado VARCHAR(20) NOT NULL DEFAULT 'bueno' CHECK (estado IN ('bueno','regular','malo','en_reparacion','baja')),
  valor NUMERIC(12,2),
  fecha_adquisicion DATE,
  creado_en TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS movimientos (
  id SERIAL PRIMARY KEY,
  bien_id INT NOT NULL REFERENCES bienes(id),
  tipo VARCHAR(20) NOT NULL,
  area_origen INT REFERENCES areas(id),
  area_destino INT REFERENCES areas(id),
  usuario_id INT REFERENCES usuarios(id),
  observacion TEXT,
  fecha TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bienes_area ON bienes(area_id);
CREATE INDEX IF NOT EXISTS idx_mov_bien ON movimientos(bien_id);

INSERT INTO areas (nombre, tipo) VALUES
 ('Aula 1A','aula'),('Aula 2A','aula'),('Laboratorio de Ciencias','laboratorio'),
 ('Laboratorio de Cómputo','laboratorio'),('Dirección','oficina'),
 ('Secretaría','oficina'),('Biblioteca','biblioteca'),('Almacén','almacen')
ON CONFLICT DO NOTHING;
INSERT INTO categorias (nombre, grupo) VALUES
 ('Pupitre','mobiliario'),('Escritorio','mobiliario'),('Pizarra','mobiliario'),
 ('Computadora','tecnologico'),('Proyector','tecnologico'),('Impresora','tecnologico'),
 ('Microscopio','didactico'),('Libro','didactico'),('Material de laboratorio','didactico')
ON CONFLICT DO NOTHING;
