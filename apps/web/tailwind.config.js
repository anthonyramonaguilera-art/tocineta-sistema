/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tocineta: {
          bg: '#0B0D11',
          card: '#161922',
          'card-hover': '#1C212E',
          border: '#262B38',
          'border-light': '#363C4D',
          yellow: '#FFE600',
          'yellow-hover': '#E6CF00',
          muted: '#8E95A5',
          green: '#00E676',
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
