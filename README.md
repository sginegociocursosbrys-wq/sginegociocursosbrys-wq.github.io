# SIRBE · Registro de Bienes Muebles Escolares

Portal web para controlar el ciclo de vida de mobiliario, equipo tecnológico y material didáctico de un colegio: **alta → traslado → mantenimiento → baja**, con historial por bien y código de inventario automático (`BM-00001`).

**Stack:** Node.js 20 + Express · PostgreSQL 16 · interfaz web sin build (HTML/CSS/JS) · Docker Compose.

## Roles
| Rol | Puede |
|---|---|
| admin | Todo, incluida la baja de bienes |
| encargado | Registrar, editar y trasladar bienes |
| docente / auditor | Consultar inventario e historial |

## Arranque local
```bash
cp .env.example .env      # cambia las claves
docker compose up -d --build
```
Abre http://localhost:3000 e ingresa con `ADMIN_EMAIL` y `ADMIN_PASSWORD` de tu `.env`. Las tablas y los datos base (áreas y categorías) se crean solos al iniciar.

Sin Docker: instala PostgreSQL, crea la base, ajusta `DATABASE_URL` y ejecuta `npm install && npm start` (Node 20+ con variables del `.env` exportadas).

## API (`/api/v1`)
`POST /auth/login` · `GET /areas` · `GET /categorias` · `GET|POST /bienes` · `GET|PUT /bienes/:id` · `POST /bienes/:id/traslado` · `POST /bienes/:id/baja` · `GET /reportes/resumen` · `GET /reportes/inventario.csv` · `GET /health`

## Flujo de trabajo colaborativo
1. Rama protegida `main`; trabaja en `feature/<tema>` o `fix/<tema>`.
2. Commits con formato Conventional Commits (`feat:`, `fix:`, `docs:`).
3. Abre un Pull Request (o Merge Request en GitLab); el CI debe estar en verde y requiere 1 revisión.
4. Para GitLab, copia los pasos de `.github/workflows/ci.yml` a un `.gitlab-ci.yml`.

## Despliegue en tu hosting
- **VPS con Docker (recomendado):** clona el repo, crea `.env`, ejecuta `docker compose up -d --build` y pon NGINX o Caddy con HTTPS delante del puerto 3000.
- **Hosting con Node.js (cPanel "Setup Node.js App", Render, Railway):** sube el repo, define las variables de `.env.example` y el comando de inicio `npm start`. Necesitas una base PostgreSQL (la del proveedor sirve) y su `DATABASE_URL`.
- Un hosting compartido solo con PHP/MySQL **no** puede ejecutar este proyecto.

## Seguridad
Cambia `JWT_SECRET`, `PG_PASSWORD` y la contraseña del administrador antes de publicar, usa siempre HTTPS y no subas el `.env` (ya está en `.gitignore`).
