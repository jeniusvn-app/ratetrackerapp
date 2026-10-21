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
        // Warm 3-color palette: Peachpuff (#FFDAB9), DarkSalmon (#E9967A), Bisque (#FFE4C4)
        // navy-* ramp remaps to warm tones for seamless propagation across existing utilities.
        navy: {
          50: '#FFF9F5',   // App background / base container
          100: '#FFE4C4',  // Bisque — tab containers, card borders, light fills
          150: '#FFE4C4',
          200: '#FFE4C4',  // Bisque borders
          300: '#C9A88A',  // Muted warm gray for placeholder text
          400: '#8B6F5C',  // Muted brown for secondary text
          500: '#5C4A3D',  // Medium warm brown
          600: '#E9967A',  // DarkSalmon — active elements
          700: '#FFDAB9',  // Peachpuff — header bar, primary blocks
          800: '#000000',  // Black text
          900: '#000000',
        },
        primary: {
          DEFAULT: '#E9967A',   // DarkSalmon
          hover: '#D98265',     // Slightly darker salmon
          light: '#FFDAB9',     // Peachpuff
        },
        accent: {
          DEFAULT: '#E9967A',   // DarkSalmon
          hover: '#D98265',
        },
        slate2: '#1E293B',
        gold: {
          50: '#FFF0EB',    // Very light salmon tint
          100: '#FFE4C4',   // Bisque
          400: '#E9967A',   // DarkSalmon
          500: '#E9967A',   // DarkSalmon — replaces orange
          600: '#D98265',   // Darker salmon hover
          700: '#A85644',   // Deep salmon for text/icons
        },
        brand: {
          orange: '#E9967A',   // DarkSalmon — replaces orange
          red: '#C8102E',
          crimson: '#C8102E',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgba(233,150,122,0.10), 0 4px 12px rgba(233,150,122,0.12)',
        pop: '0 8px 32px rgba(233,150,122,0.22)',
      },
    },
  },
  plugins: [],
};
