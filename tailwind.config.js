/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        surface: {
          950: '#06080F',
          900: '#0B0F19',
          850: '#0F1626',
          800: '#141D32',
          700: '#1E2B48',
          600: '#2A3B5E',
        },
        pulse: {
          cyan: '#06B6D4',
          cyanGlow: '#22D3EE',
          violet: '#8B5CF6',
          violetGlow: '#A78BFA',
          emerald: '#10B981',
          emeraldGlow: '#34D399',
          amber: '#F59E0B',
          amberGlow: '#FBBF24',
          rose: '#F43F5E',
          roseGlow: '#FB7185',
        }
      },
      boxShadow: {
        'glow-cyan': '0 0 30px -5px rgba(6, 182, 212, 0.35)',
        'glow-cyan-lg': '0 0 50px -5px rgba(6, 182, 212, 0.5)',
        'glow-violet': '0 0 30px -5px rgba(139, 92, 246, 0.35)',
        'glow-emerald': '0 0 30px -5px rgba(16, 185, 129, 0.35)',
        'glow-amber': '0 0 30px -5px rgba(245, 158, 11, 0.35)',
        'glow-rose': '0 0 30px -5px rgba(244, 63, 94, 0.35)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.45)',
        'inner-light': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.08)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 12s linear infinite',
        'radar': 'radar 3s ease-in-out infinite',
        'scan': 'scan 2s ease-in-out infinite',
      },
      keyframes: {
        radar: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        scan: {
          '0%, 100%': { transform: 'translateY(-100%)' },
          '50%': { transform: 'translateY(100%)' },
        }
      }
    },
  },
  plugins: [],
};
