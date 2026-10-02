import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { LocaleProvider } from './i18n/locale.jsx'
import { ThemeProvider, applyMode, initialMode } from './theme/theme.jsx'
import ThemedApp from './ThemedApp.jsx'
import './App.css'

// Set the mode before the first render rather than in an effect after it,
// so a dark-mode operator does not get a white page for a frame. An
// inline script in index.html would be earlier still, but the API serves
// a content security policy and this is close enough: nothing is painted
// until this module runs anyway.
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
