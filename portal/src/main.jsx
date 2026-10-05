import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider, applyMode, initialMode } from './theme/theme.jsx'
import { LocaleProvider } from './i18n/locale.jsx'
import ThemedApp from './ThemedApp.jsx'
import './App.css'

// Set the mode before the first render rather than in an effect after it,
// so a customer on dark mode does not get a white page for a frame.
applyMode(initialMode())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <LocaleProvider>
        <ThemeProvider>
          <ThemedApp />
        </ThemeProvider>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>
)
