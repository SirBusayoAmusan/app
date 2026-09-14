/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#1d1d1f', soft: '#424245', mute: '#6e6e73', faint: '#86868b' },
        line: { DEFAULT: '#e8e8ed', soft: '#f0f0f4' },
        canvas: { DEFAULT: '#f6f6f8', card: '#ffffff' },
        lilac: { 50: '#f4f2ff', 100: '#ece8ff', 200: '#ded6ff', 500: '#7c5cff', 600: '#6842f0' },
        moss: { 50: '#eefaf1', 100: '#dcf5e3', 500: '#1faa53', 600: '#128043' },
        sun: { 50: '#fff9ec', 100: '#fdf0d5', 500: '#d98324', 600: '#b56616' },
        rose: { 50: '#fff2f4', 100: '#ffe1e6', 500: '#e0355b', 600: '#bb2145' },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem', xl3: '1.75rem' },
      boxShadow: {
        card: '0 1px 2px rgba(16,16,20,.04), 0 8px 24px -18px rgba(16,16,20,.25)',
        lift: '0 2px 6px rgba(16,16,20,.05), 0 24px 48px -28px rgba(16,16,20,.35)',
        inset: 'inset 0 1px 0 rgba(255,255,255,.6)',
      },
      keyframes: {
        fadeUp: { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'none' } },
        fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        pulseSoft: { '0%,100%': { opacity: 1 }, '50%': { opacity: .45 } },
      },
      animation: {
        fadeUp: 'fadeUp .38s cubic-bezier(.22,.61,.36,1) both',
        fadeIn: 'fadeIn .25s ease both',
        shimmer: 'shimmer 1.6s infinite',
        pulseSoft: 'pulseSoft 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
