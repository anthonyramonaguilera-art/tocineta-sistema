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
        tocineta: {
          bg: 'var(--tocineta-bg)',
          card: 'var(--tocineta-card)',
          'card-hover': 'var(--tocineta-card-hover)',
          border: 'var(--tocineta-border)',
          'border-light': 'var(--tocineta-border-light)',
          text: 'var(--tocineta-text)',
          muted: 'var(--tocineta-muted)',
          blue: 'var(--tocineta-blue)',
          yellow: 'var(--tocineta-yellow)',
          'yellow-hover': 'var(--tocineta-yellow-hover)',
          green: 'var(--tocineta-green)',
          amber: '#FF9100',
          red: '#FF3D00'
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
      }
    },
  },
  plugins: [],
}
