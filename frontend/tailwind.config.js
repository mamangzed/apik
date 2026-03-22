/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // APIX dark theme (Bruno-inspired)
        app: {
          bg: '#1c2128',
          sidebar: '#161b22',
          panel: '#22272e',
          border: '#30363d',
          hover: '#2d333b',
          active: '#373e47',
          text: '#cdd9e5',
          muted: '#768390',
          accent: '#f97316',
          'accent-hover': '#ea6c0a',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
