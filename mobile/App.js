import React from 'react';
import { LocaleProvider } from './src/i18n/locale.js';
import { AuthProvider } from './src/auth/AuthContext';
import { ScanSettingsProvider } from './src/context/ScanSettingsContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <ScanSettingsProvider>
          <AppNavigator />
        </ScanSettingsProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
