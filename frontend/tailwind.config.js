/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0c1017',
          900: '#0f1520',
          800: '#141924',
          700: '#1a2235',
          600: '#1e2a3a',
        },
        text: {
          primary: '#e2e8f0',
          body: '#c8d2de',
          secondary: '#8a96a8',
          muted: '#5a6778',
        },
        accent: {
          teal: '#2d8e72',
          amber: '#e8a838',
          blue: '#4a6fa5',
          red: '#e85d4a',
          green: '#2d8e72',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body: ['DM Sans', 'sans-serif'],
        mono: ['Courier Prime', 'monospace'],
      },
    },
  },
  plugins: [],
}
