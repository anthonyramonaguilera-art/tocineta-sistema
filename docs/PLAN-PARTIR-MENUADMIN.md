# Plan para partir `MenuAdminView.tsx` (G2)

Estado: **diagnóstico solamente**. Este documento no modifica código. Los rangos de línea
corresponden al commit `8597a6d` (`feat(go-live): modales del UI kit...`), donde
`apps/web/src/components/MenuAdminView.tsx` tiene **1694 líneas físicas / 1695 según el guard**.
El techo del baseline de G1 sigue en 1698.

Objetivo: extraer el archivo en tramos, **un bloque por prompt**, hacia
`apps/web/src/features/menu-admin/<Nombre>.tsx`, con props explícitas, sin contexto nuevo,
sin cambiar comportamiento ni estilos, y con cada archivo nuevo **≤ 400 líneas**.

> `apps/web/src/features/menu-admin/MenuAdminView.tsx` (2 líneas) es solo un re-export del
> componente actual; no es el archivo a partir. No confundir ambas rutas.

## 1. Mapa actual (rangos exactos)

| # | Bloque | Rango | Líneas | Tipo |
|---|---|---|---|---|
| 1 | Imports, `normalizeSearch` | 1-28 | 28 | cabecera |
| 2 | Inicio del componente y estado | 30-115 | 86 | estado |
| 3 | `useQuery` catálogo admin + `useLoadState` | 117-151 | 35 | datos |
| 4 | Mutaciones | 153-379 | 227 | efectos |
| 4.1 | Toggle disponibilidad de producto | 153-170 | 18 | mutación |
| 4.2 | Toggle disponibilidad de sabor | 172-189 | 18 | mutación |
| 4.3 | Guardar producto (crear/actualizar + foto) | 191-260 | 70 | mutación |
| 4.4 | Actualizar tasa BCV | 262-285 | 24 | mutación |
| 4.5 | Crear cupón | 287-323 | 37 | mutación |
| 4.6 | Toggle cupón | 325-337 | 13 | mutación |
| 4.7 | Eliminar cupón | 339-351 | 13 | mutación |
| 4.8 | Crear categoría | 353-379 | 27 | mutación |
| 5 | Derivados de catálogo (`availableIngredients`, categoría por defecto) | 381-396 | 16 | derivados |
| 6 | Abrir/cerrar editor de producto | 398-436 | 39 | handlers |
| 7 | Ingredientes (`handleAddIngredient`, `handleRemoveIngredient`) | 438-512 | 75 | handlers |
| 8 | Foto (`handlePhotoSelect`, compresión) | 514-538 | 25 | handlers |
| 9 | Derivados de catálogo (`categoryMap`, `inactiveCategoryIds`, `filteredProducts`) | 540-574 | 35 | derivados |
| 10 | `LoadBoundary` de carga/error | 576-591 | 16 | render |
| 11 | Render raíz + Toast de feedback | 593-612 | 20 | render |
| 11.1 | Cabecera "Categorías y Organización" + botón Nueva Categoría | 614-638 | 25 | render |
| 11.2 | Pestañas del panel admin | 640-699 | 60 | render |
| 11.3 | Vista 1: catálogo de productos | 701-955 | 255 | render |
| 11.3.1 | Filtros por categoría + Mostrar ocultos + Nuevo Producto | 707-756 | 50 | render |
| 11.3.2 | Buscador | 758-779 | 22 | render |
| 11.3.3 | Grilla + tarjeta de producto (map) | 781-953 | 173 | render |
| 11.4 | Vista: calculadora financiera | 957-1053 | 97 | render |
| 11.5 | Vista: materia prima y variación de costos | 1055-1120 | 66 | render |
| 11.6 | Vista 2: cupones | 1122-1295 | 174 | render |
| 11.6.1 | Formulario crear cupón | 1127-1210 | 84 | render |
| 11.6.2 | Listado y filtro de cupones | 1212-1293 | 82 | render |
| 11.7 | Vista 3: tasa BCV | 1297-1367 | 71 | render |
| 11.8 | Modal editor/creador de producto | 1369-1601 | 233 | modal |
| 11.8.1 | Ficha (nombre, categoría, precios, estación, descripción) | 1384-1476 | 93 | modal |
| 11.8.2 | Subida de fotografía | 1478-1502 | 25 | modal |
| 11.8.3 | Ingredientes (lista + alta) | 1504-1581 | 78 | modal |
| 11.8.4 | Pie Cancelar/Guardar | 1584-1598 | 15 | modal |
| 11.9 | Modal nueva categoría | 1603-1668 | 66 | modal |
| 11.10 | `DeleteProductDialog` | 1669-1676 | 8 | componente ya extraído |
| 11.11 | `ConfirmDialog` de cupón | 1678-1691 | 14 | modal |
| 11.12 | Cierre del componente | 1692-1694 | 3 | render |

## 2. Estado, datos y efectos: quién usa qué

### Estado local

| Estado | Líneas | Consumido por | ¿Exclusivo de un bloque? |
|---|---|---|---|
| `activeTab`, `selectedCategory`, `searchQuery` | 34-36 | pestañas + catálogo | Catálogo/tabs (el tab es global) |
| `feedbackMessage` | 40 | raíz (Toast) + errores de producto/categoría/cupón | **Global** (se pasa por callback) |
| `editingProduct`, `isCreatingProduct` | 37, 42 | editor de producto + apertura | Editor de producto |
| `photoBase64`, `photoNotice` | 43-44 | editor de producto + guardado | Editor de producto |
| `customMargins` | 45 | catálogo **y** calculadora | **Compartido** |
| `isCategoryModalOpen`, `newCatName`, `newCatStation` | 97-100 | modal categoría | Modal categoría |
| `newRateInput`, `rateMessage`, `isSyncingBcv` | 102-104 | vista BCV | Vista BCV |
| `couponCode`, `couponType`, `discountMode`, `discountValue`, `couponDesc`, `showAllCoupons` | 106-111 | vista cupones | Vista cupones |
| `productToDelete` | 38 | `DeleteProductDialog` | Catálogo (diálogo) |
| `couponToDelete` | 41 | `ConfirmDialog` de cupón | Vista cupones |
| `formName`…`formDescription` | 83-89 | modal producto | Modal producto |
| `productIngredients`, `selectedExistingIng`, `newIngName`, `isAddingIngredient` | 91-95 | modal producto | Modal producto |

### Consultas y mutaciones

| Recurso | Líneas | Usado por | ¿Exclusivo? |
|---|---|---|---|
| `useQuery(['adminMenu'])` | 117-144 | todo el componente | **Global** |
| `useQuery(['profitabilitySupplies'])` | 54-61 | vista materia prima | **Sí** |
| `toggleAvailabilityMutation` | 153-170 | tarjeta de producto | Catálogo |
| `toggleFlavorMutation` | 172-189 | tarjeta de producto | Catálogo |
| `saveProductMutation` | 191-260 | modal producto | **Sí** |
| `updateRateMutation` | 262-285 | vista BCV | **Sí** |
| `createCouponMutation`, `toggleCouponMutation`, `deleteCouponMutation` | 287-351 | vista cupones | **Sí** |
| `createCategoryMutation` | 353-379 | modal categoría | **Sí** |
| `applySuggestedPriceMutation` | 64-81 | catálogo **y** calculadora | **Compartido** |

### Derivados y utilidades

- `availableIngredients` (381-391): alimenta el alta de ingredientes del modal.
- `defaultCreateCategoryId` (393-396): alimenta `openCreateModal`.
- `categoryMap`, `inactiveCategoryIds`, `filteredProducts` (540-574): solo catálogo.
- `normalizeSearch` (27-28): solo filtros del catálogo.
- `compressImage`, `dataUrlByteSize` (23): solo foto.
- `useBodyScrollLock(isCreatingProduct)` y `useBodyScrollLock(isCategoryModalOpen)` (114-115):
  deben viajar con cada modal.

## 3. Orden de extracción propuesto (de menor a mayor riesgo)

Criterio: primero lo que no comparte estado ni mutaciones con otra sección; al final lo que
concentra el flujo crítico (formulario de producto, foto, ingredientes y guardado).

| Paso | Componente nuevo | Origen | Props explícitas | Estado/efectos que se mueven | Nuevo ≈ | Padre −≈ | Riesgo |
|---|---|---|---|---|---|---|---|
| 1 | `BcvRateAdminView.tsx` | 1297-1367, 262-285, 102-104 | `formattedRate: string`, `token: string \| null` | `newRateInput`, `rateMessage`, `isSyncingBcv`, `updateRateMutation`; usa `useQueryClient` dentro | 90 | 98 | **Bajo** |
| 2 | `SuppliesCostsView.tsx` | 1055-1120, 54-61 | ninguna (usa `apiFetch` y su propia query) | query `profitabilitySupplies` | 75 | 78 | **Bajo** |
| 3 | `NewCategoryModal.tsx` | 1603-1668, 353-379, 97-100, 115 | `isOpen`, `onClose`, `token`, `onError(msg)` | `isCategoryModalOpen`, `newCatName`, `newCatStation`, `createCategoryMutation` | 85 | 100 | **Bajo** |
| 4 | `PricingCalculatorView.tsx` | 957-1053 | `products: AdminProduct[]`, `customMargins`, `onMarginChange(id, valor)`, `onApplySuggestedPrice(id, cents)`, `isApplying` | ninguno (mutación y estado compartidos se quedan en el padre) | 105 | 97 | **Bajo-medio** |
| 5 | `ProductCard.tsx` | 781-953 (cuerpo del `map`) | `product`, `flavors`, `margin`, `isCategoryInactive`, `isApplyingSuggested`, `onMarginChange`, `onApplySuggested`, `onEdit`, `onDelete`, `onToggleFlavor`, `onError` | ninguno (la tarjeta es presentacional) | 170 | 164 | **Medio** |
| 6 | `CouponsAdminView.tsx` | 1122-1295, 287-351, 106-111, 41, 1678-1691 | `coupons: AdminCoupon[]`, `token: string \| null` | los 6 estados de cupón, `couponToDelete`, las 3 mutaciones y el `ConfirmDialog` | 245 | 251 | **Medio** |
| 7 | `MenuProductsGrid.tsx` | 701-955 (filtros, buscador, grilla) | `products`, `categories`, `flavors`, `customMargins`, callbacks de edición/borrado/errores, mutaciones de toggle y precio | `selectedCategory`, `searchQuery`, `showHiddenProducts` (pasan al hijo) | 210 | 90 | **Medio-alto** |
| 8a | `ProductIngredientsEditor.tsx` | 1504-1581, 438-512, 91-95, 381-391 | `productId`, `ingredients`, `availableIngredients`, `onChange(ingredients)`, `token`, `onError` | `productIngredients`, `selectedExistingIng`, `newIngName`, `isAddingIngredient`; handlers | 150 | 169 | **Alto** |
| 8b | `ProductPhotoField.tsx` | 1478-1502, 514-538, 43-44 | `photoBase64`, `onChange(base64)`, `notice`, `onNotice(msg)` | `handlePhotoSelect`, compresión de imagen | 90 | 52 | **Alto** |
| 8c | `ProductEditorModal.tsx` | 1369-1601 (resto), 83-89, 191-260, 398-436, 114 | `isOpen`, `product`, `categories`, `rateMicroBs`, `token`, `onClose`, `onSaved`, `onError` | estados del formulario, `saveProductMutation`, apertura/cierre, `useBodyScrollLock` | 300 | 295 | **Alto** |

Notas del orden:

- Los pasos 1-4 reducen ~373 líneas con riesgo bajo; son el arranque natural.
- `ProductCard` (5) es la primera extracción "de tarjeta": aísla 170 líneas de JSX repetido
  y deja el catálogo más fácil de mover en el paso 7.
- `CouponsAdminView` (6) es autocontenido, pero mueve tres mutaciones y la confirmación de
  borrado: se hace después de las vistas simples y antes del catálogo.
- El modal de producto **no cabe en 400 líneas si se mueve entero** (~430-450 con su lógica).
  Por eso se parte en 8a/8b/8c, cada uno por separado y en ese orden (primero lo interno,
  al final la cáscara del modal). 8c debe quedar por debajo de 400 o volver a dividirse.
- Los pasos 1-8 dejan el archivo padre alrededor de **300 líneas** (estimación), cumpliendo el
  límite de 400 sin extraer las pestañas ni la cabecera de categorías.

## 4. Contratos de referencia para cada tramo

Reglas comunes:

- Importar UI desde `../../ui/index.js` (o `../../../ui/index.js` según profundidad); tipos
  desde `../../types/menu.js` o los `types.ts` de la feature.
- Nada de contexto nuevo: si un dato es compartido (`customMargins`, `applySuggestedPriceMutation`,
  `feedbackMessage`), se queda en el padre y baja por props/callbacks.
- Mover estado local **solo** si el bloque es su único consumidor.
- Conservar exactamente textos, clases, endpoints, `queryKey`, invalidaciones y orden de hooks.
- Mantener `useBodyScrollLock` en el componente que renderiza el modal.
- Cada archivo nuevo: ≤ 400 líneas, sin colores fijos, sin emojis, con `min-h-[48px]` en
  controles táctiles.

Contratos puntuales:

1. **`BcvRateAdminView`**: recibe `formattedRate` y `token`; internamente `useMutation` contra
   `/api/menu/exchange-rate` y `/api/menu/exchange-rate/sync-now`, e invalida `adminMenu`/
   `posMenu` con `useQueryClient`. No recibe callbacks de feedback: replica `rateMessage`.
2. **`SuppliesCostsView`**: sin props; conserva `queryKey: ['profitabilitySupplies']` y la
   lectura de `suppliesData?.supplies`.
3. **`NewCategoryModal`**: `onError` reemplaza a `setFeedbackMessage`; al crear con éxito se
   cierra y se invalida `adminMenu`/`posMenu` como hoy.
4. **`PricingCalculatorView`**: no mueve `applySuggestedPriceMutation` (la comparte el
   catálogo); recibe `onApplySuggestedPrice`.
5. **`ProductCard`**: recibe `onToggleFlavor(flavorId, isAvailable)` en lugar de la mutación;
   `ProductStatusControls` sigue siendo hijo de la tarjeta.
6. **`CouponsAdminView`**: recibe `coupons`; `token` para las mutaciones; el `ConfirmDialog`
   de borrado vive dentro del componente. El éxito de creación limpia código/descripción como hoy.
7. **`MenuProductsGrid`**: conserva `filteredProducts` (o recibe `products` ya filtrados) y
   `customMargins` por props; `openEditModal`/`setProductToDelete` bajan como callbacks.
8. **Editor de producto**: `onSaved` reemplaza a `closeProductModal + feedback`; la subida de
   foto sigue ocurriendo dentro de la mutación de guardado.

## 5. Verificación por tramo

Después de cada extracción:

1. `pnpm run guard` (0 errores; actualizar el techo de `MenuAdminView` en
   `scripts/ui-guard-baseline.json` al nuevo conteo, porque el archivo se reduce).
2. `pnpm -r run lint` y `pnpm -r run build`.
3. Prueba manual de la sección extraída:
   - **BCV**: actualizar tasa, sincronizar por internet, mensaje de error.
   - **Materia prima**: tabla, variación y stock.
   - **Nueva categoría**: crear, cancelar, Escape, error de servidor.
   - **Calculadora**: cambiar margen y aplicar precio sugerido.
   - **Tarjeta**: agotar/ocultar, sabores, editar, eliminar, aplicar margen.
   - **Cupones**: crear, activar/desactivar, eliminar con confirmación, filtro de agotados.
   - **Catálogo**: filtros, búsqueda, mostrar ocultos, nuevo producto.
   - **Editor de producto**: crear/editar, foto (límite 12 MB/2 MB), ingredientes, guardar.
4. `git diff --stat` debe mostrar solo el archivo padre, el nuevo componente y, si aplica,
   el baseline.

## 6. Riesgos conocidos y mitigación

| Riesgo | Mitigación |
|---|---|
| `customMargins` y `applySuggestedPriceMutation` compartidos entre catálogo y calculadora | Se quedan en el padre; se pasan por props. No moverlos con la calculadora. |
| `feedbackMessage` global lo usan producto, categoría, cupones y `DeleteProductDialog` | Pasar `onError`/`onSuccess`; no crear contexto. |
| El modal de producto supera 400 líneas si se mueve completo | Partirlo en 8a/8b/8c (ingredientes, foto, cáscara). |
| El guard congela el techo en 1698 y el archivo ya está en 1695 | Cada extracción debe actualizar el techo al conteo nuevo; nunca debe subir. |
| Cambios de comportamiento por mover hooks/estado | Extraer primero lo presentacional; probar cada sección; no alterar endpoints ni invalidaciones. |
| Confusión entre `components/MenuAdminView.tsx` y el re-export de `features/menu-admin/MenuAdminView.tsx` | Los componentes nuevos van en `features/menu-admin/`; el re-export no se toca. |

## 7. Fuera de alcance

- `menu-service.ts`, rutas del servidor y otros componentes.
- Rediseño visual o cambios de textos.
- Extraer las pestañas (640-699) y la cabecera de categorías (614-638): son pequeños y de
  bajo valor; si al final se necesitan para bajar de 400, se evalúan en un tramo aparte.
