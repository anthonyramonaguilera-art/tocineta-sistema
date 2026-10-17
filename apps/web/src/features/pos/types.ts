export type ModifierType = 'SIN_INGREDIENTE' | 'POCO_INGREDIENTE' | 'EXTRA_INGREDIENTE' | 'BARRA_LIBRE';

export interface CustomizationModifier {
  ingredientId?: string;
  ingredientName: string;
  modifierType: ModifierType;
  extraPriceUsdCents: number;
}

export interface ComboChildLine {
  productId: string;
  productName: string;
  quantity: number;
  modifiers: CustomizationModifier[];
  flavorChoice?: string;
  customInstructions?: string;
}

export interface CartItem {
  clientLineId: string;
  productId: string;
  productName: string;
  station: string;
  quantity: number;
  unitPriceUsdCents: number;
  isCombo: boolean;
  modifiers: CustomizationModifier[];
  flavorChoice?: string;
  customInstructions?: string;
  comboChildren?: ComboChildLine[];
}

export interface OutboxOrder {
  idempotencyKey: string;
  payload: any;
  token?: string;
  createdAtMs: number;
  attempts: number;
  lastError?: string;
}
