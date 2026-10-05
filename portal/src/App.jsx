import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, hasFeature } from './auth.jsx';
import { useLocale } from './i18n/locale.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Inventory from './pages/Inventory.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import NewOrder from './pages/NewOrder.jsx';
import Inbound from './pages/Inbound.jsx';
import Invoices from './pages/Invoices.jsx';
import InvoiceDetail from './pages/InvoiceDetail.jsx';

function ProtectedRoute({ children }) {
  const { account, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!account) return <Navigate to="/login" replace />;
  // Forced password change (mig 088 defaults must_change_password TRUE on
  // every provisioned login). /auth/me is the source of truth: the
  // middleware answers 403 password_change_required on every other portal
  // endpoint anyway, so letting the user roam would only show them empty
  // pages.
  if (account.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

/**
 * Feature gate for a whole route.
 *
 * Cosmetic, exactly like the nav filter: @require_customer_feature
 * returns 403 on the API call regardless. Its job is to explain the
 * situation ("chưa được cấp quyền") instead of rendering a page that
 * loads into an error box.
 */
function FeatureRoute({ feature, children }) {
  const { account } = useAuth();
  const { t } = useLocale();
  if (!hasFeature(account, feature)) {
    return (
      <div className="page page-narrow">
        <h1>{t('chrome.feature.title')}</h1>
        <div className="alert alert-warning" role="status">
          {t('chrome.feature.body')}
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { t } = useLocale();
  return (
    <Routes>
      <Route path="/login" element={<ErrorBoundary fallbackMessage={t('chrome.load.login')}><Login /></ErrorBoundary>} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route
          path="/"
          element={<ErrorBoundary fallbackMessage={t('chrome.load.dashboard')}><Dashboard /></ErrorBoundary>}
        />
        <Route
          path="/change-password"
          element={<ErrorBoundary fallbackMessage={t('chrome.load.changePassword')}><ChangePassword /></ErrorBoundary>}
        />
        <Route
          path="/inventory"
          element={(
            <FeatureRoute feature="inventory">
              <ErrorBoundary fallbackMessage={t('chrome.load.inventory')}><Inventory /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route
          path="/orders"
          element={(
            <FeatureRoute feature="orders">
              <ErrorBoundary fallbackMessage={t('chrome.load.orders')}><Orders /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route
          path="/orders/new"
          element={(
            <FeatureRoute feature="orders">
              <ErrorBoundary fallbackMessage={t('chrome.load.newOrder')}><NewOrder /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route
          path="/orders/:soNumber"
          element={(
            <FeatureRoute feature="orders">
              <ErrorBoundary fallbackMessage={t('chrome.load.orderDetail')}><OrderDetail /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route
          path="/inbound"
          element={(
            <FeatureRoute feature="inbound">
              <ErrorBoundary fallbackMessage={t('chrome.load.inbound')}><Inbound /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route
          path="/invoices"
          element={(
            <FeatureRoute feature="invoices">
              <ErrorBoundary fallbackMessage={t('chrome.load.invoices')}><Invoices /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route
          path="/invoices/:invoiceNumber"
          element={(
            <FeatureRoute feature="invoices">
              <ErrorBoundary fallbackMessage={t('chrome.load.invoiceDetail')}><InvoiceDetail /></ErrorBoundary>
            </FeatureRoute>
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
