<!-- web-app-ux-auditor:start -->
# Web App UX Auditor

Use the web-app-ux-auditor Agent Skill for web app UI/UX reviews, redesigns, navigation audits, onboarding, forms, accessibility, keyboard/focus behavior, Core Web Vitals, retention, and conversion improvements.

Canonical skill path in this project: .agents/skills/web-app-ux-auditor/SKILL.md

Follow the skill workflow before recommending changes:
- inspect code, routes, layouts, components, forms, design tokens, states, accessibility tooling, and runtime behavior;
- run the bundled static scanner when code is available;
- rank findings by user impact;
- verify with browser walkthroughs, keyboard checks, screenshots, performance data, tests, or static evidence.
<!-- web-app-ux-auditor:end -->

# REGLAS ESTRICTAS DE INGENIERÍA Y GOBERNANZA DEL SISTEMA "TOCINETA" (PRD v2.0)
1. **CERO REFERENCIAS A NOMBRES PROPIOS O MARCAS EXTERNAS:**
   - Prohibido en código, base de datos, migraciones o UI los nombres: `Olinelcys`, `Anthony`, `Carlos`, `Andrea`, `Miguel`, `José`, `Valery`, `Treinta`, `Sonríe`, `God Mode`, `Modo Dios`, `Varons`.
   - Marca única y oficial del sistema: **"TOCINETA"**.
   - Perfiles corporativos por defecto: **`ADMIN`**, **`CAJERA`**, **`MESERO`**, **`PLANCHA`**, **`DESPACHO`**.
2. **MODO CLARO POR DEFECTO (`light`) Y CONTRASTE SEMÁNTICO:**
   - Toda la aplicación inicia por defecto en Modo Claro.
   - Prohibido texto blanco sobre fondos claros o cajas oscuras sin adaptación de tema.
3. **DISEÑO 100% TOUCH / MOBILE-FIRST:**
   - Flujos guiados *"Siguiente ➔ Siguiente"*, botones grandes (`min-h-[48px]` a `54px`) y cero módulos placeholder o ficticios.
4. **VALIDACIÓN EXCLUSIVA DE COMPILACIÓN:**
   - Durante la Fase 1, no correr `vitest`. Validar exclusivamente con `pnpm -r run lint` (`tsc --noEmit`) y `pnpm -r run build`.

