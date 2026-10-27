import React, { useState } from 'react';
import {
  Sun, Moon, ShoppingBag, Plus, Trash2, ArrowRight,
  Sparkles, CheckCircle2, User, Search
} from 'lucide-react';
import {
  Button, Card, Field, Input, Select, Modal,
  Tabs, Chips, Badge, EmptyState, Toast, Money, NumberPad
} from '../../ui/index.js';

export const UiKitView: React.FC = () => {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('botones');
  const [activeChip, setActiveChip] = useState('todos');
  const [numberPadVal, setNumberPadVal] = useState('12.50');
  const [selectedCard, setSelectedCard] = useState<number | null>(1);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('tocineta_theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('tocineta_theme', 'light');
    }
  };

  return (
    <div className="min-h-screen bg-surface text-ink p-4 md:p-8 max-w-4xl mx-auto space-y-8">
      {/* Top Bar with Theme Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black text-ink">Catálogo de Componentes UI</h1>
            <Badge variant="primary">v1.0 Oficial</Badge>
          </div>
          <p className="text-sm text-ink-muted mt-1">
            Sistema de tokens semánticos TOCINETA. Contraste verificado WCAG AA.
          </p>
        </div>

        <Button
          variant="secondary"
          onClick={toggleTheme}
          iconStart={isDark ? <Sun className="w-5 h-5 text-primary" /> : <Moon className="w-5 h-5" />}
        >
          {isDark ? 'Cambiar a Modo Claro' : 'Cambiar a Modo Oscuro'}
        </Button>
      </div>

      {/* Tabs navigation */}
      <Tabs
        activeId={activeTab}
        onChange={setActiveTab}
        items={[
          { id: 'botones', label: 'Botones y Acciones' },
          { id: 'formularios', label: 'Formularios y Entradas' },
          { id: 'datos', label: 'Dinero y Estados' },
          { id: 'contenedores', label: 'Tarjetas y Modales' }
        ]}
      />

      {/* TAB 1: Botones */}
      {activeTab === 'botones' && (
        <div className="space-y-6">
          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Variantes de Botón (min-h-[48px])</h2>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary" iconStart={<ShoppingBag className="w-5 h-5" />}>
                Primario (Amarillo de Marca)
              </Button>
              <Button variant="secondary" iconStart={<Plus className="w-5 h-5" />}>
                Secundario (Superficie)
              </Button>
              <Button variant="danger" iconStart={<Trash2 className="w-5 h-5" />}>
                Peligro (Rojo)
              </Button>
              <Button variant="ghost">
                Fantasma
              </Button>
            </div>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Tamaños y Estados</h2>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Pequeño (40px)</Button>
              <Button size="md">Mediano (48px - Táctil)</Button>
              <Button size="lg">Grande (56px)</Button>
              <Button isLoading>Cargando</Button>
              <Button disabled>Deshabilitado</Button>
            </div>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Chips Desplazables</h2>
            <Chips
              selectedId={activeChip}
              onChange={setActiveChip}
              items={[
                { id: 'todos', label: 'Todos', badge: 24 },
                { id: 'hotdogs', label: 'Hot Dogs', badge: 7 },
                { id: 'hamburguesas', label: 'Hamburguesas', badge: 8 },
                { id: 'combos', label: 'Combos', badge: 3 },
                { id: 'extras', label: 'Extras', badge: 6 }
              ]}
            />
          </Card>
        </div>
      )}

      {/* TAB 2: Formularios */}
      {activeTab === 'formularios' && (
        <div className="space-y-6">
          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Campos y Entradas Táctiles</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nombre y Apellido" required hint="Mínimo 3 caracteres">
                <Input placeholder="Ej. Juan Pérez" iconStart={<User className="w-5 h-5" />} />
              </Field>

              <Field label="Campo con Error" error="El nombre es obligatorio para continuar">
                <Input hasError placeholder="Entrada inválida" />
              </Field>

              <Field label="Búsqueda de Catálogo">
                <Input placeholder="Buscar hot dog o hamburguesa..." iconStart={<Search className="w-5 h-5" />} />
              </Field>

              <Field label="Canal de Venta">
                <Select defaultValue="aqui">
                  <option value="aqui">Comer aquí</option>
                  <option value="llevar">Para llevar</option>
                  <option value="delivery">Delivery</option>
                </Select>
              </Field>
            </div>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Teclado Numérico Táctil (NumberPad)</h2>
            <p className="text-xs text-ink-muted">Valor actual: <strong className="text-ink">{numberPadVal || '0.00'}</strong></p>
            <NumberPad
              value={numberPadVal}
              onChange={setNumberPadVal}
              enterLabel="Aceptar monto"
              onEnter={() => alert(`Monto ingresado: ${numberPadVal}`)}
            />
          </Card>
        </div>
      )}

      {/* TAB 3: Datos y Estados */}
      {activeTab === 'datos' && (
        <div className="space-y-6">
          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Componente Money (USD Grande / Bs Pequeño)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
              <div className="space-y-1">
                <span className="text-xs text-ink-muted">Tamaño sm:</span>
                <Money amountCents={250} size="sm" rateMicroBs={36587200} />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-ink-muted">Tamaño md:</span>
                <Money amountCents={690} size="md" rateMicroBs={36587200} />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-ink-muted">Tamaño lg:</span>
                <Money amountCents={1300} size="lg" rateMicroBs={36587200} />
              </div>
              <div className="space-y-1">
                <span className="text-xs text-ink-muted">Tamaño xl (Gigante):</span>
                <Money amountCents={1390} size="xl" rateMicroBs={36587200} />
              </div>
            </div>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Badges de Estado</h2>
            <div className="flex flex-wrap gap-2.5">
              <Badge variant="primary">Primario</Badge>
              <Badge variant="success" icon={<CheckCircle2 className="w-3.5 h-3.5" />}>Completado</Badge>
              <Badge variant="danger">Cancelado</Badge>
              <Badge variant="warning">Pendiente</Badge>
              <Badge variant="neutral">Inactivo</Badge>
              <Badge variant="brand">Marca TOCINETA</Badge>
            </div>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Notificaciones Toast</h2>
            <div className="space-y-2.5 max-w-sm">
              <Toast type="success" message="Pedido enviado a cocina" description="Comanda #42 impresa con éxito" />
              <Toast type="error" message="Error de validación" description="Debe ingresar el nombre del cliente" />
              <Toast type="info" message="Tasa BCV sincronizada" description="Tasa vigente: 36,5872 Bs/USD" />
            </div>
          </Card>
        </div>
      )}

      {/* TAB 4: Contenedores y Modales */}
      {activeTab === 'contenedores' && (
        <div className="space-y-6">
          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Tarjetas Interactivas de Canal</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card
                variant="interactive"
                selected={selectedCard === 1}
                onClick={() => setSelectedCard(1)}
              >
                <div className="font-bold text-base">Comer aquí</div>
                <p className="text-xs text-ink-muted mt-1">Mesas táctiles</p>
              </Card>

              <Card
                variant="interactive"
                selected={selectedCard === 2}
                onClick={() => setSelectedCard(2)}
              >
                <div className="font-bold text-base">Para llevar</div>
                <p className="text-xs text-ink-muted mt-1">Entrega en barra</p>
              </Card>

              <Card
                variant="interactive"
                selected={selectedCard === 3}
                onClick={() => setSelectedCard(3)}
              >
                <div className="font-bold text-base">Delivery</div>
                <p className="text-xs text-ink-muted mt-1">Envío a domicilio</p>
              </Card>
            </div>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Modal / BottomSheet</h2>
            <Button
              variant="primary"
              onClick={() => setIsModalOpen(true)}
              iconEnd={<ArrowRight className="w-5 h-5" />}
            >
              Abrir Modal (BottomSheet en Móvil)
            </Button>

            <Modal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              title="Personalizar Hamburguesa"
              description="Selecciona los ingredientes y extras"
              footer={
                <>
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" onClick={() => setIsModalOpen(false)}>
                    Confirmar
                  </Button>
                </>
              }
            >
              <div className="space-y-4">
                <p className="text-sm text-ink leading-relaxed">
                  En dispositivos móviles (pantallas &lt; 640px), este contenedor se desliza suavemente desde abajo como un BottomSheet táctil. En tablets y escritorio, se centra como una ventana modal accesible.
                </p>
                <Chips
                  items={[
                    { id: '1', label: 'Sin cebolla' },
                    { id: '2', label: 'Sin pan' },
                    { id: '3', label: 'Extra carne (+$1.00)' },
                    { id: '4', label: 'Full tocineta (+$1.00)' }
                  ]}
                  selectedIds={['1', '3']}
                />
              </div>
            </Modal>
          </Card>

          <Card variant="alt" className="space-y-4">
            <h2 className="text-base font-bold text-ink">Estado Vacío (EmptyState)</h2>
            <EmptyState
              icon={<Sparkles className="w-6 h-6 text-primary" />}
              title="Sin pedidos pendientes"
              description="No hay pedidos activos en este momento. Los nuevos pedidos aparecerán aquí."
              action={
                <Button variant="primary" iconStart={<Plus className="w-5 h-5" />}>
                  Crear primer pedido
                </Button>
              }
            />
          </Card>
        </div>
      )}
    </div>
  );
};
