/**
 * Ghostwatch Mobile design tokens — derived from the web app's index.css.
 * HSL values from the web's :root block converted to hex.
 * Both light and dark are set to the same dark-only palette (app is dark-only).
 */

const colors = {
  light: {
    // Core surfaces — Bloomberg terminal dark
    background: '#030711',
    foreground: '#e1e7ef',

    // Cards / elevated surfaces
    card: '#060e1a',
    cardForeground: '#e1e7ef',

    // Primary action color — Ghostwatch cyan
    primary: '#00eeff',
    primaryForeground: '#030711',

    // Secondary / interactive surfaces
    secondary: '#182840',
    secondaryForeground: '#e1e7ef',

    // Muted elements
    muted: '#182840',
    mutedForeground: '#7892aa',

    // Accent (dark cyan)
    accent: '#002d33',
    accentForeground: '#00eeff',

    // Destructive
    destructive: '#ff1a35',
    destructiveForeground: '#e1e7ef',

    // Borders / inputs
    border: '#182840',
    input: '#182840',

    // Risk tier colors — carried over from web design tokens
    safe: '#20bf60',
    safeForeground: '#0a2018',
    balanced: '#f5a013',
    balancedForeground: '#2a1a00',
    aggressive: '#ff1a35',
    aggressiveForeground: '#2a0008',

    // Legacy aliases
    text: '#e1e7ef',
    tint: '#00eeff',
  },

  dark: {
    // Same dark palette — app forces dark mode
    background: '#030711',
    foreground: '#e1e7ef',
    card: '#060e1a',
    cardForeground: '#e1e7ef',
    primary: '#00eeff',
    primaryForeground: '#030711',
    secondary: '#182840',
    secondaryForeground: '#e1e7ef',
    muted: '#182840',
    mutedForeground: '#7892aa',
    accent: '#002d33',
    accentForeground: '#00eeff',
    destructive: '#ff1a35',
    destructiveForeground: '#e1e7ef',
    border: '#182840',
    input: '#182840',
    safe: '#20bf60',
    safeForeground: '#0a2018',
    balanced: '#f5a013',
    balancedForeground: '#2a1a00',
    aggressive: '#ff1a35',
    aggressiveForeground: '#2a0008',
    text: '#e1e7ef',
    tint: '#00eeff',
  },

  // Border radius in px — web uses 0.25rem = 4px
  radius: 4,
};

export default colors;
