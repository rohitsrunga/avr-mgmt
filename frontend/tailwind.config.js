/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          subtle: '#fbfbfd',
          muted: '#f5f5f7',
          sunken: '#eeeef0',
        },
        line: {
          DEFAULT: '#d2d2d7',
          subtle: '#e5e5ea',
          strong: '#a1a1a6',
        },
        ink: {
          DEFAULT: '#1d1d1f',
          body: '#424245',
          muted: '#6e6e73',
          faint: '#86868b',
        },
        brand: {
          DEFAULT: '#0071e3',
          hover: '#0077ed',
          pressed: '#006edb',
          tint: '#e8f1fd',
        },
        positive: {
          DEFAULT: '#1d8a4b',
          tint: '#e3f3ea',
        },
        warning: {
          DEFAULT: '#9a6700',
          tint: '#fdf3da',
        },
        danger: {
          DEFAULT: '#bf2c2c',
          tint: '#fdecec',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"SF Pro Display"',
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          '"SF Mono"',
          'ui-monospace',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '10px',
        lg: '14px',
        xl: '18px',
        '2xl': '22px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0, 0, 0, 0.04), 0 1px 1px rgba(0, 0, 0, 0.03)',
        elevated: '0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)',
        focus: '0 0 0 4px rgba(0, 113, 227, 0.18)',
      },
      letterSpacing: {
        tightish: '-0.012em',
        tight: '-0.022em',
        tighter: '-0.03em',
      },
    },
  },
  plugins: [],
}
