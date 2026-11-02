# TOCINETA — Sistema Operativo y ERP Gastronómico Local

Sistema operativo comercial y ERP de alta disponibilidad diseñado para restaurantes y entornos gastronómicos. Opera en red local con soporte de tolerancia a fallos, base de datos SQLite integrada, impresión térmica ESC/POS, control de caja multimoneda y sincronización con comanderos táctiles y KDS.

## 1. Estructura del Monorepo

- `apps/server`: Servidor HTTP/WebSocket con Fastify, base de datos SQLite (Drizzle ORM), motor de impresión y control de acceso.
- `apps/web`: Interfaz de usuario táctil con React, Vite, Tailwind CSS y TanStack Query.
- `packages/shared`: Esquemas de validación Zod, contratos de dominio, utilidades monetarias y definición de Ticket IR.
- `tools/g0-probe`: Herramientas de diagnóstico de red y prueba directa de impresoras térmicas.
- `scripts`: Scripts de empaquetado, instalación y administración de servicios en Windows.
- `docs`: Protocolos de restauración, arquitectura y manuales operativos.

## 2. Requisitos del Sistema

- Node.js LTS (v20 o superior).
- pnpm (v10 o superior, monorepo gestionado con pnpm workspaces).
- Sistema Operativo: Windows 10/11 (para spooler nativo de impresión) o Linux.

## 3. Instalación y Arranque

1. Copiar la plantilla de configuración de entorno:
   ```bash
   cp .env.example .env
   ```
2. Instalar dependencias del monorepo:
   ```bash
   pnpm install
   ```
3. Ejecutar las migraciones de base de datos:
   ```bash
   pnpm run db:migrate
   ```
4. Compilar los paquetes y aplicaciones:
   ```bash
   pnpm run build
   ```
5. Iniciar el servidor en producción:
   ```bash
   pnpm run start
   ```

Para desarrollo local simultáneo:
```bash
pnpm run dev:server
pnpm run dev:web
```

## 4. Verificación y Calidad de Código

El repositorio cuenta con validaciones automatizadas de consistencia y diseño:

- Validador estricto de UI y reglas semánticas:
  ```bash
  pnpm run guard
  ```
- Verificación de tipos TypeScript:
  ```bash
  pnpm run lint
  ```
- Pruebas unitarias y de integración:
  ```bash
  pnpm run test
  ```

## 5. Respaldos y Recuperación

El sistema ejecuta snapshots periódicos y respaldos cifrados con claves asimétricas para resguardo en unidades USB externas. Consulte el procedimiento operativo en:
- `docs/restore.md`

## 6. Gobernanza y Reglas de Desarrollo

Para la evolución del código fuente, arquitectura y gobernanza del proyecto, revise:
- `AGENTS.md` (Reglas estrictas de ingeniería, UI táctil y control de cambios)
- `BITACORA-DE-CONTEXTO.md` (Decisiones arquitectónicas D1–D9 y registro histórico)
