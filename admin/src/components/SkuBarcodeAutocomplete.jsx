import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { buildItemScanOptions, resolveItemFromScan } from '../utils/itemScanOptions.js';
import { useLocale } from '../i18n/locale.jsx';

/**
 * SKU / barcode autocomplete — same pattern as the other search boxes:
 * native <input list> + debounced /admin/items?q= fetch.
 */
export default function SkuBarcodeAutocomplete({
  value,
  onChange,
  onItemSelect,
  onSearchingChange,
  listId: listIdProp,
  placeholder,
  className = 'form-input',
  minChars = 1,
  perPage = 12,
  activeOnly = true,
  staticItems = [],
  disabled = false,
  inputRef,
  onKeyDown,
  onBlur,
  style,
  mono = false,
  autoComplete = 'off',
  apiOptions = {},
  useLookupSearch = false,
  showNoMatch = false,
}) {
  const { t } = useLocale();
  const autoId = useId();
  const listId = listIdProp || `sku-ac-${autoId.replace(/:/g, '')}`;
  const [items, setItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef(null);
  const onItemSelectRef = useRef(onItemSelect);
  const onSearchingChangeRef = useRef(onSearchingChange);
  const apiOptionsRef = useRef(apiOptions);
  onItemSelectRef.current = onItemSelect;
  onSearchingChangeRef.current = onSearchingChange;
  apiOptionsRef.current = apiOptions;

  useEffect(() => {
    onSearchingChangeRef.current?.(searching);
  }, [searching]);

  useEffect(() => {
    const q = String(value || '').trim();
    if (q.length < minChars) {
      setItems([]);
      setSearching(false);
      return undefined;
    }

    setSearching(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (useLookupSearch) {
        const exact = await api.get(`/lookup/item/${encodeURIComponent(q)}`, {
          silentPermissionDenied: true,
          ...apiOptionsRef.current,
        });
        if (exact?.ok) {
          const item = await exact.json();
          setItems(item?.item_id ? [item] : []);
          setSearching(false);
          return;
        }
        const res = await api.get(`/lookup/item/search?q=${encodeURIComponent(q)}`, {
          silentPermissionDenied: true,
          ...apiOptionsRef.current,
        });
        let found = [];
        if (res?.ok) {
          const data = await res.json();
          found = Array.isArray(data) ? data : [];
        }
        if (!found.length) {
          const params = new URLSearchParams({ q, per_page: String(perPage), active: 'true' });
          const adminRes = await api.get(`/admin/items?${params}`, {
            silentPermissionDenied: true,
            ...apiOptionsRef.current,
          });
          if (adminRes?.ok) {
            const data = await adminRes.json();
            found = data.items || [];
          }
        }
        setItems(found);
        setSearching(false);
        return;
      }

      const params = new URLSearchParams({ q, per_page: String(perPage) });
      if (activeOnly) params.set('active', 'true');
      const res = await api.get(`/admin/items?${params}`, apiOptionsRef.current);
      setSearching(false);
      if (!res?.ok) {
        setItems([]);
        return;
      }
      const data = await res.json();
      setItems(data.items || []);
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, minChars, perPage, activeOnly, useLookupSearch]);

  const allItems = useMemo(() => {
    const byId = new Map();
    [...staticItems, ...items].forEach((it) => {
      if (it?.item_id != null) byId.set(it.item_id, it);
    });
    return [...byId.values()];
  }, [staticItems, items]);

  const options = useMemo(() => buildItemScanOptions(allItems), [allItems]);
  const resolved = useMemo(() => resolveItemFromScan(value, allItems), [value, allItems]);

  useEffect(() => {
    onItemSelectRef.current?.(resolved);
  }, [resolved]);

  function handleChange(e) {
    onChange(e.target.value);
  }

  function handleBlur(e) {
    onBlur?.(e);
  }

  const inputClass = mono ? `${className} mono`.trim() : className;
  const trimmed = String(value || '').trim();

  return (
    <>
      <input
        ref={inputRef}
        className={inputClass}
        list={listId}
        placeholder={placeholder ?? t('skuSearch.placeholder')}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={onKeyDown}
        disabled={disabled}
        style={style}
        autoComplete={autoComplete}
        aria-busy={searching}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={`${o.value}-${o.item?.item_id}`} value={o.value}>{o.label}</option>
        ))}
      </datalist>
      {showNoMatch && !searching && trimmed.length >= minChars && !resolved && options.length === 0 && (
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
          {t('skuSearch.noMatch', { query: trimmed })}
        </div>
      )}
    </>
  );
}

export { resolveItemFromScan, buildItemScanOptions };
