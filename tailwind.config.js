/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Paleta Consulte GEO (alinhada com geoRDO)
        navy: {
          DEFAULT: '#182863',
          50:  '#f0f3fb',
          100: '#dde4f6',
          200: '#b3c1eb',
          300: '#7d92dc',
          400: '#5170c8',
          500: '#3854b3',
          600: '#2a4196',
          700: '#21357b',
          800: '#182863',
          900: '#0E1B40',
          950: '#070e26',
        },
        navyDeep: '#0E1B40',
        purple: {
          DEFAULT: '#3E2D71',
          50:  '#f4f1fa',
          100: '#e7e0f4',
          200: '#cdc0e9',
          300: '#a99cd5',
          400: '#866dbe',
          500: '#6849a8',
          600: '#52378d',
          700: '#3E2D71',
          800: '#33245d',
          900: '#241841',
        },
        magenta: {
          DEFAULT: '#C5117E',
          50:  '#fdf2f7',
          100: '#fae4ef',
          200: '#f6cce0',
          300: '#f198c4',
          400: '#e864a4',
          500: '#dc3a89',
          600: '#C5117E',
          700: '#a30b66',
          800: '#860a55',
          900: '#660744',
        },
        // Cores semânticas
        success: '#16A34A',
        warning: '#F59E0B',
        error:   '#DC2626',
        // Brand aliases (compat com componentes RDO usando bg-brand-*)
        'brand-navy':    '#182863',
        'brand-purple':  '#3E2D71',
        'brand-magenta': '#C5117E',
        // Dark mode primitivos
        background: { DEFAULT: '#ffffff', dark: '#0b1020' },
        card:       { DEFAULT: '#ffffff', dark: '#111733' },
        border:     { DEFAULT: '#e2e8f0', dark: '#1f2748' },
        input:      { DEFAULT: '#ffffff', dark: '#0f1530' },
        muted:      { DEFAULT: '#f1f5f9', dark: '#161d3a' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Padrão RDO/Consulte GEO
        DEFAULT: '0.5rem',  // 8px = rounded
        lg: '0.5rem',       // botões e inputs
        xl: '0.75rem',      // cards
        '2xl': '1rem',      // modais
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.05), 0 1px 3px 0 rgb(0 0 0 / 0.08)',
        elevated: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
      },
    },
  },
  plugins: [],
};
