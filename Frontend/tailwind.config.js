/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "node_modules/daisyui/dist/**/*.js",
    "node_modules/react-daisyui/dist/**/*.js",
  ],
  theme: {
    extend: {},
  },
  daisyui: {
    themes: [{
      bronze: {
        "color-scheme": "dark",
        "primary": "#dba367", "primary-content": "#24190e",
        "secondary": "#b8ab9b", "secondary-content": "#181613",
        "accent": "#dda568", "accent-content": "#24190e",
        "neutral": "#302d27", "neutral-content": "#f4ece0",
        "base-100": "#151310", "base-200": "#211f1c", "base-300": "#302d27", "base-content": "#f4ece0",
        "info": "#89b9e5", "info-content": "#151310",
        "success": "#8ac9b2", "success-content": "#151310",
        "warning": "#f0c477", "warning-content": "#24190e",
        "error": "#f49a8b", "error-content": "#24190e",
        "--rounded-box": "0.75rem", "--rounded-btn": "0.6rem", "--animation-btn": "0",
      },
    }, "winter"],
  },
  plugins: [require("daisyui")],
};
