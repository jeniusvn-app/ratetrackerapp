/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Roboto', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Roboto', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // "Space Cadet Navy & Radiant Orange" design system.
        // navy-* ramp maps existing utility usage onto the Space Cadet palette.
        navy: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          150: '#EBF0F7',
          200: '#E2E8F0',
          300: '#94A3B8',
          400: '#2A3A6E',
          500: '#1D2951',
          600: '#152042',
          700: '#1D2951',
          800: '#1D2951',
          900: '#152042',
        },
        primary: {
          DEFAULT: '#1D2951',
          hover: '#152042',
          light: '#2A3A6E',
        },
        accent: {
          DEFAULT: '#FF7E36',
          hover: '#E06825',
        },
        slate2: '#1E293B',
        gold: {
          400: '#FFA45C',
          500: '#FF7E36',
          600: '#E06825',
        },
        brand: {
          orange: '#FF7E36',
          red: '#FF3E3D',
          crimson: '#C8102E',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(29,41,81,0.06), 0 4px 12px rgba(29,41,81,0.08)',
        pop: '0 8px 32px rgba(29,41,81,0.18)',
      },
    },
  },
  plugins: [],
};
