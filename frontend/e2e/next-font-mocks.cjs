/** Offline responses used by focused Playwright runs in network-restricted CI. */
module.exports = {
  'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap': `
    @font-face {
      font-family: 'Inter';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(mock-inter-variable-font.woff2) format('woff2');
    }
  `,
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap': `
    @font-face {
      font-family: 'IBM Plex Sans Arabic';
      font-style: normal;
      font-weight: 400 700;
      font-display: swap;
      src: url(mock-ibm-plex-sans-arabic-font.woff2) format('woff2');
    }
  `,
};
