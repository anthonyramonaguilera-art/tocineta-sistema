/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Tokens Semánticos Oficiales ---
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
          hover: 'var(--color-surface-hover)',
          active: 'var(--color-surface-active)'
        },
        border: {
          DEFAULT: 'var(--color-border)',
          subtle: 'var(--color-border-subtle)'
        },
        ink: {
          DEFAULT: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
          inverse: 'var(--color-ink-inverse)'
        },
        primary: {
          DEFAULT: 'var(--color-primary)',
          ink: 'var(--color-primary-ink)',
          hover: 'var(--color-primary-hover)',
          subtle: 'var(--color-primary-subtle)'
        },
        brand: {
          yellow: '#FFE600',
          red: '#981010',
          'red-ink': '#FFFFFF',
          orange: '#F89800',
          ink: '#111111'
        },
        danger: {
          DEFAULT: 'var(--color-danger)',
          ink: 'var(--color-danger-ink)',
          subtle: 'var(--color-danger-subtle)'
        },
        success: {
          DEFAULT: 'var(--color-success)',
          ink: 'var(--color-success-ink)',
          subtle: 'var(--color-success-subtle)'
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          ink: 'var(--color-warning-ink)',
          subtle: 'var(--color-warning-subtle)'
        },
        focus: {
          DEFAULT: 'var(--color-focus)',
          ring: 'var(--color-focus-ring)'
        },

        // --- Compatibilidad hacia atrás mapeada a tokens semánticos ---
        tocineta: {
          bg: 'var(--color-surface)',
          card: 'var(--color-surface-alt)',
          'card-hover': 'var(--color-surface-hover)',
          border: 'var(--color-border)',
          'border-light': 'var(--color-border-subtle)',
          text: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
          yellow: 'var(--color-primary)',
          'yellow-hover': 'var(--color-primary-hover)',
          red: 'var(--color-brand-red)',
          orange: 'var(--color-brand-orange)',
          green: 'var(--color-success)',
          blue: '#0284C7'
        }
      },
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif'
        ]
      },
      minHeight: {
        touch: '48px',
        header: '56px'
      }
    },
  },
  plugins: [],
}
