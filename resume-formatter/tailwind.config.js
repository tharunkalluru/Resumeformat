/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        resume: ['Georgia', 'Times New Roman', 'serif'],
      },
      colors: {
        resume: {
          primary: '#1a1a1a',
          secondary: '#4a4a4a',
          accent: '#2563eb',
          border: '#e5e5e5',
        }
      }
    },
  },
  plugins: [],
}
