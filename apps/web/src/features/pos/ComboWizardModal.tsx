import React, { useState, useMemo } from 'react';
import type { PosProduct } from '../../types/menu.js';
import type { CartItem, ComboChildLine, CustomizationModifier } from './types.js';
import { CustomizationModal } from './CustomizationModal.js';
import { generateUuidV7 } from '@tocineta/shared';

interface ComboWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  combo: PosProduct;
  allProducts: PosProduct[];
  barraLibreList?: Array<{ id: string; name: string }>;
  onComplete: (comboCartItem: CartItem) => void;
}

const PEPSI_FLAVORS = ['Pepsi', '7Up', 'Frescolita', 'Manzanita', 'Piña', 'Naranja'];

export const ComboWizardModal: React.FC<ComboWizardModalProps> = ({
  isOpen,
  onClose,
  combo,
  allProducts,
  barraLibreList = [],
  onComplete
}) => {
  if (!isOpen) return null;

  const isComboParaTi = combo.id === 'prod_combo_para_ti' || combo.name.toLowerCase().includes('para ti');
  const isComboStreet = combo.id === 'prod_combo_street' || combo.name.toLowerCase().includes('street');

  // Opciones de Hamburguesas $6.90 para Combo Para Ti
  const burgerOptions = useMemo(() => {
    return allProducts.filter(p => p.station === 'hamburguesas' && (p.priceUsdCents === 690 || !p.isCombo));
  }, [allProducts]);

  // Opciones de Perros para Combos
  const dogOptions = useMemo(() => {
    return allProducts.filter(p => p.station === 'hot_dogs' && !p.isCombo);
  }, [allProducts]);

  // Paso actual (1, 2, 3)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Selecciones para el Combo
  // Paso 1
  const [child1ProductId, setChild1ProductId] = useState<string>(() => {
    if (isComboParaTi) return burgerOptions[0]?.id || 'prod_texas_mex';
    if (isComboStreet) return 'prod_street_dog';
    return dogOptions[0]?.id || 'prod_street_dog';
  });
  const [child1Modifiers, setChild1Modifiers] = useState<CustomizationModifier[]>([]);
  const [child1Instructions, setChild1Instructions] = useState<string>('');

  // Paso 2
  const [child2ProductId, setChild2ProductId] = useState<string>(() => {
    if (isComboParaTi) return burgerOptions[1]?.id || burgerOptions[0]?.id || 'prod_miami';
    if (isComboStreet) return 'prod_street_dog';
    return dogOptions[1]?.id || dogOptions[0]?.id || 'prod_doritos_dog_snacks';
  });
  const [child2Modifiers, setChild2Modifiers] = useState<CustomizationModifier[]>([]);
  const [child2Instructions, setChild2Instructions] = useState<string>('');

  // Paso 3 (Bebida)
  const [sodaFlavor, setSodaFlavor] = useState<string>('Pepsi');

  // Estado para abrir CustomizationModal sobre un ítem específico del combo
  const [customizingStep, setCustomizingStep] = useState<1 | 2 | null>(null);

  const selectedProduct1 = allProducts.find(p => p.id === child1ProductId);
  const selectedProduct2 = allProducts.find(p => p.id === child2ProductId);

  // Manejar guardado de personalización de un hijo
  const handleSaveChildCustomization = (
    mods: CustomizationModifier[],
    instructions: string
  ) => {
    if (customizingStep === 1) {
      setChild1Modifiers(mods);
      setChild1Instructions(instructions);
    } else if (customizingStep === 2) {
      setChild2Modifiers(mods);
      setChild2Instructions(instructions);
    }
    setCustomizingStep(null);
  };

  // Finalizar el combo
  const handleFinalize = () => {
    const children: ComboChildLine[] = [];

    // Hijo 1
    const p1 = selectedProduct1 || { name: 'Ítem 1', id: child1ProductId };
    children.push({
      productId: p1.id,
      productName: p1.name,
      quantity: 1,
      modifiers: child1Modifiers,
      customInstructions: child1Instructions
    });

    // Hijo 2
    const p2 = selectedProduct2 || { name: 'Ítem 2', id: child2ProductId };
    children.push({
      productId: p2.id,
      productName: p2.name,
      quantity: 1,
      modifiers: child2Modifiers,
      customInstructions: child2Instructions
    });

    // Hijo 3 (Bebida)
    if (isComboParaTi) {
      const soda = allProducts.find(p => p.id === 'prod_refresco_1lt') || { id: 'prod_refresco_1lt', name: 'Refresco 1 Lt' };
      children.push({
        productId: soda.id,
        productName: `${soda.name} (${sodaFlavor})`,
        quantity: 1,
        modifiers: [],
        flavorChoice: sodaFlavor
      });
    } else {
      const malta = allProducts.find(p => p.id === 'prod_malta_lata_250') || { id: 'prod_malta_lata_250', name: 'Malta Lata 250 ml' };
      children.push({
        productId: malta.id,
        productName: malta.name,
        quantity: 1,
        modifiers: []
      });
    }

    const comboItem: CartItem = {
      clientLineId: `cline_${generateUuidV7()}`,
      productId: combo.id,
      productName: combo.name,
      station: combo.station,
      quantity: 1,
      unitPriceUsdCents: combo.priceUsdCents,
      isCombo: true,
      modifiers: [],
      comboChildren: children
    };

    onComplete(comboItem);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
        <div className="bg-tocineta-card border border-tocineta-border rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
          
          {/* Cabecera */}
          <div className="px-6 py-4 bg-tocineta-bg border-b border-tocineta-border flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">✨</span>
                <h2 className="text-lg font-black text-white">{combo.name}</h2>
                <span className="text-sm px-2.5 py-0.5 rounded-full bg-tocineta-yellow text-tocineta-bg font-mono font-black">
                  ${(combo.priceUsdCents / 100).toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-tocineta-muted mt-0.5">
                Configurador guiado paso a paso para armar y personalizar tu combo
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-12 h-12 flex items-center justify-center rounded-2xl bg-tocineta-card hover:bg-tocineta-border text-tocineta-muted hover:text-white transition-all text-xl font-bold"
              aria-label="Cerrar modal"
            >
              ✕
            </button>
          </div>

          {/* Stepper Superior */}
          <div className="px-6 py-3 bg-tocineta-card/50 border-b border-tocineta-border flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                currentStep === 1
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow'
                  : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]">1</span>
              <span>{isComboParaTi ? 'Hamburguesa 1' : 'Perro 1'}</span>
            </button>

            <span className="text-tocineta-border">→</span>

            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                currentStep === 2
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow'
                  : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]">2</span>
              <span>{isComboParaTi ? 'Hamburguesa 2' : 'Perro 2'}</span>
            </button>

            <span className="text-tocineta-border">→</span>

            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                currentStep === 3
                  ? 'bg-tocineta-yellow text-tocineta-bg shadow'
                  : 'text-tocineta-muted hover:text-white'
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]">3</span>
              <span>Bebida</span>
            </button>
          </div>

          {/* Contenido del Paso */}
          <div className="p-6 overflow-y-auto space-y-5 flex-1">
            
            {/* PASO 1: Elegir y Personalizar Ítem #1 */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-wider text-tocineta-yellow">
                    Paso 1: Selecciona {isComboParaTi ? 'la 1ra Hamburguesa ($6.90)' : 'el 1er Perro'}
                  </h3>
                  <span className="text-xs text-tocineta-muted">1 de 3</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(isComboParaTi ? burgerOptions : dogOptions).map(opt => {
                    const isSelected = opt.id === child1ProductId;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setChild1ProductId(opt.id);
                          setChild1Modifiers([]);
                        }}
                        className={`min-h-[52px] p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-tocineta-yellow/15 border-tocineta-yellow text-white shadow-md'
                            : 'bg-tocineta-bg border-tocineta-border text-tocineta-muted hover:text-white hover:border-tocineta-border-light'
                        }`}
                      >
                        <span className="font-bold text-sm text-white">{opt.name}</span>
                        <span className="text-[10px] text-tocineta-muted">Precio regular: ${(opt.priceUsdCents / 100).toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Personalizar Ítem 1 */}
                <div className="p-4 bg-tocineta-bg border border-tocineta-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-white block">
                      Personalización de: <span className="text-tocineta-yellow">{selectedProduct1?.name}</span>
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {child1Modifiers.length === 0 ? (
                        <span className="text-[11px] text-tocineta-muted italic">Receta normal de cocina</span>
                      ) : (
                        child1Modifiers.map((m, idx) => (
                          <span
                            key={idx}
                            className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                              m.modifierType === 'SIN_INGREDIENTE'
                                ? 'bg-red-500/20 text-red-300'
                                : m.modifierType === 'POCO_INGREDIENTE'
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {m.modifierType === 'SIN_INGREDIENTE' ? `Sin ${m.ingredientName}` : m.ingredientName}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCustomizingStep(1)}
                    className="min-h-[48px] px-4 rounded-xl bg-tocineta-card border border-tocineta-yellow/60 text-tocineta-yellow hover:bg-tocineta-yellow hover:text-tocineta-bg font-bold text-xs transition-all flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <span>⚙️ Personalizar Ingredientes</span>
                  </button>
                </div>
              </div>
            )}

            {/* PASO 2: Elegir y Personalizar Ítem #2 */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-wider text-tocineta-yellow">
                    Paso 2: Selecciona {isComboParaTi ? 'la 2da Hamburguesa ($6.90)' : 'el 2do Perro'}
                  </h3>
                  <span className="text-xs text-tocineta-muted">2 de 3</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(isComboParaTi ? burgerOptions : dogOptions).map(opt => {
                    const isSelected = opt.id === child2ProductId;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setChild2ProductId(opt.id);
                          setChild2Modifiers([]);
                        }}
                        className={`min-h-[52px] p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                          isSelected
                            ? 'bg-tocineta-yellow/15 border-tocineta-yellow text-white shadow-md'
                            : 'bg-tocineta-bg border-tocineta-border text-tocineta-muted hover:text-white hover:border-tocineta-border-light'
                        }`}
                      >
                        <span className="font-bold text-sm text-white">{opt.name}</span>
                        <span className="text-[10px] text-tocineta-muted">Precio regular: ${(opt.priceUsdCents / 100).toFixed(2)}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Personalizar Ítem 2 */}
                <div className="p-4 bg-tocineta-bg border border-tocineta-border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-white block">
                      Personalización de: <span className="text-tocineta-yellow">{selectedProduct2?.name}</span>
                    </span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {child2Modifiers.length === 0 ? (
                        <span className="text-[11px] text-tocineta-muted italic">Receta normal de cocina</span>
                      ) : (
                        child2Modifiers.map((m, idx) => (
                          <span
                            key={idx}
                            className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                              m.modifierType === 'SIN_INGREDIENTE'
                                ? 'bg-red-500/20 text-red-300'
                                : m.modifierType === 'POCO_INGREDIENTE'
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {m.modifierType === 'SIN_INGREDIENTE' ? `Sin ${m.ingredientName}` : m.ingredientName}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setCustomizingStep(2)}
                    className="min-h-[48px] px-4 rounded-xl bg-tocineta-card border border-tocineta-yellow/60 text-tocineta-yellow hover:bg-tocineta-yellow hover:text-tocineta-bg font-bold text-xs transition-all flex items-center justify-center gap-1.5 shrink-0"
                  >
                    <span>⚙️ Personalizar Ingredientes</span>
                  </button>
                </div>
              </div>
            )}

            {/* PASO 3: Bebida Incluida */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-black uppercase tracking-wider text-tocineta-yellow">
                    Paso 3: Bebida Incluida en el Combo
                  </h3>
                  <span className="text-xs text-tocineta-muted">3 de 3</span>
                </div>

                {isComboParaTi ? (
                  <div className="space-y-3">
                    <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                      <span className="text-sm font-bold text-white block">Refresco 1 Lt Oficial Pepsi</span>
                      <span className="text-xs text-tocineta-muted">Selecciona uno de los 6 sabores disponibles:</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {PEPSI_FLAVORS.map(flavor => {
                        const isSelected = sodaFlavor === flavor;
                        return (
                          <button
                            key={flavor}
                            type="button"
                            onClick={() => setSodaFlavor(flavor)}
                            className={`min-h-[48px] p-3 rounded-2xl border font-bold text-sm transition-all flex items-center justify-between ${
                              isSelected
                                ? 'bg-tocineta-yellow text-tocineta-bg shadow-md'
                                : 'bg-tocineta-bg border-tocineta-border text-tocineta-muted hover:text-white'
                            }`}
                          >
                            <span>{flavor}</span>
                            <span>{isSelected ? '✓' : ''}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-5 bg-tocineta-bg border border-tocineta-border rounded-2xl text-center space-y-2">
                    <span className="text-4xl block">🥤</span>
                    <h4 className="text-base font-bold text-white">1 Malta Lata 250 ml</h4>
                    <p className="text-xs text-tocineta-muted">Bebida oficial fría incluida en este combo</p>
                    <span className="inline-block text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/30">
                      Incluida ($0.00 Adicional)
                    </span>
                  </div>
                )}
              </div>
            )}

          </div>

          {/* Pie con Navegación y Finalizar */}
          <div className="p-4 bg-tocineta-bg border-t border-tocineta-border flex items-center justify-between gap-3">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStep(prev => prev - 1)}
                className="w-1/3 min-h-[52px] rounded-2xl bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-sm transition-all flex items-center justify-center active:scale-95"
              >
                ← Anterior
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="w-1/3 min-h-[52px] rounded-2xl bg-tocineta-card border border-tocineta-border text-tocineta-muted hover:text-white font-bold text-sm transition-all flex items-center justify-center active:scale-95"
              >
                Cancelar
              </button>
            )}

            {currentStep < 3 ? (
              <button
                type="button"
                onClick={() => setCurrentStep(prev => prev + 1)}
                className="w-2/3 min-h-[52px] rounded-2xl bg-tocineta-yellow text-tocineta-bg font-black text-base transition-all flex items-center justify-center gap-2 hover:bg-tocineta-yellow-hover active:scale-95 shadow-xl"
              >
                <span>Continuar al Paso {currentStep + 1}</span>
                <span>→</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalize}
                className="w-2/3 min-h-[52px] rounded-2xl bg-emerald-500 text-white font-black text-base transition-all flex items-center justify-center gap-2 hover:bg-emerald-600 active:scale-95 shadow-xl"
              >
                <span>✓ Agregar Combo al Pedido</span>
                <span className="px-2 py-0.5 rounded-lg bg-black/20 text-xs font-mono">
                  ${(combo.priceUsdCents / 100).toFixed(2)}
                </span>
              </button>
            )}
          </div>

        </div>
      </div>

      {/* Sub-modal de personalización para el ítem seleccionado */}
      {customizingStep !== null && (
        <CustomizationModal
          isOpen={true}
          onClose={() => setCustomizingStep(null)}
          product={customizingStep === 1 ? (selectedProduct1 || combo) : (selectedProduct2 || combo)}
          initialModifiers={customizingStep === 1 ? child1Modifiers : child2Modifiers}
          initialInstructions={customizingStep === 1 ? child1Instructions : child2Instructions}
          barraLibreList={barraLibreList}
          onSave={handleSaveChildCustomization}
        />
      )}
    </>
  );
};
