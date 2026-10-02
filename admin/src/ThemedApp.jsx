import { ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import enUS from 'antd/locale/en_US';
import { useLocale } from './i18n/locale.jsx';
import { AuthProvider } from './auth.jsx';
import { WarehouseProvider } from './warehouse.jsx';
import { useTheme } from './theme/theme.jsx';
import { buildAntdTheme } from './theme/antdTheme.js';
import App from './App.jsx';

/**
 * Feeds antd the palette for whichever mode is currently set.
 *
 * It sits between ThemeProvider and the app because ConfigProvider takes
 * its theme as a prop, not from context -- so something has to read the
 * mode and rebuild the config when it changes. That is the whole job.
 */
export default function ThemedApp() {
  const { mode } = useTheme();
  const { locale } = useLocale();
  return (
    /* antd ships its own strings for the bits a page never writes by
       hand -- pagination, empty states, date pickers -- so its locale
       has to follow the app's, or `en` shows "Trang Trước". */
    <ConfigProvider theme={buildAntdTheme(mode)} locale={locale === 'en' ? enUS : viVN}>
      <AuthProvider>
        <WarehouseProvider>
          <App />
        </WarehouseProvider>
      </AuthProvider>
    </ConfigProvider>
  );
}
