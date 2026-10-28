/**
 * Type-level verification test for Icon system.
 * Proves that string literals matching IconName compile,
 * but arbitrary strings trigger TypeScript compiler errors.
 */
import React from 'react';
import { Icon } from './Icon.js';
import { Button } from './Button.js';
import { Badge } from './Badge.js';
import { Tabs } from './Tabs.js';
import { Chips } from './Chips.js';
import { EmptyState } from './EmptyState.js';
import { Input } from './Input.js';

export function testValidIconTypes() {
  // Valid uses must compile without error
  React.createElement(Icon, { name: 'Flame' });
  React.createElement(Button, { leftIcon: 'Flame' }, 'Accion');
  React.createElement(Button, { rightIcon: 'Check' }, 'Accion');
  React.createElement(Badge, { icon: 'Flame', children: 'Texto' });
  React.createElement(Tabs, { items: [{ id: '1', label: 'Tab', icon: 'Flame' }], activeTab: '1', onChange: () => {} });
  React.createElement(Chips, { items: [{ id: '1', label: 'Chip', icon: 'Flame' }], selectedId: '1', onSelect: () => {} });
  React.createElement(EmptyState, { title: 'Vacio', icon: 'Inbox' });
  React.createElement(Input, { iconStart: 'Search' });
}

export function testInvalidIconTypes() {
  // Arbitrary strings must fail compilation with @ts-expect-error
  React.createElement(Icon, {
    // @ts-expect-error - Arbitrary string must fail compilation on Icon name
    name: 'TextoInvalido'
  });

  React.createElement(Button, {
    // @ts-expect-error - Arbitrary string must fail compilation on Button leftIcon: <Button leftIcon="Texto"> no compila
    leftIcon: 'Texto'
  }, 'Accion');

  React.createElement(Button, {
    // @ts-expect-error - Arbitrary string must fail compilation on Button rightIcon
    rightIcon: 'TextoNoValido'
  }, 'Accion');

  React.createElement(Badge, {
    // @ts-expect-error - Arbitrary string must fail compilation on Badge icon
    icon: 'IconoFalso',
    children: 'Texto'
  });

  React.createElement(Tabs, {
    items: [
      {
        id: '1',
        label: 'Tab',
        // @ts-expect-error - Arbitrary string must fail compilation on TabItem icon
        icon: 'NoExiste'
      }
    ],
    activeTab: '1',
    onChange: () => {}
  });

  React.createElement(EmptyState, {
    title: 'Vacio',
    // @ts-expect-error - Arbitrary string must fail compilation on EmptyState icon
    icon: 'IconoInexistente'
  });

  React.createElement(Input, {
    // @ts-expect-error - Arbitrary string must fail compilation on Input iconStart
    iconStart: 'Invalido'
  });
}
