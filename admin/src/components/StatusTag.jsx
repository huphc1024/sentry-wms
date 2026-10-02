import { useLocale } from '../i18n/locale.jsx';

const STATUS_MAP = {
  OPEN: 'tag-info',
  'Ready to pick': 'tag-info',
  PARTIAL: 'tag-warning',
  IN_PROGRESS: 'tag-purple',
  PICKED: 'tag-purple',
  PACKED: 'tag-success',
  COMPLETED: 'tag-success',
  COMPLETE: 'tag-success',
  RECEIVED: 'tag-success',
  SHIPPED: 'tag-success',
  CLOSED: 'tag-gray',
  CANCELLED: 'tag-gray',
  REFUNDED: 'tag-warning',
  INACTIVE: 'tag-gray',
  LOW: 'tag-danger',
  VARIANCE: 'tag-danger',
  SHORT: 'tag-danger',
  ARCHIVED: 'tag-gray',
};

export default function StatusTag({ status }) {
  const { t } = useLocale();
  if (!status) return null;
  const cls = STATUS_MAP[status] || 'tag-gray';
  const label = t(`status.${status}`, status);
  return <span className={`tag ${cls}`}>{label}</span>;
}
