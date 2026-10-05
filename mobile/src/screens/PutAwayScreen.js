import React, { useState, useRef } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Modal, StyleSheet } from 'react-native';
import ScanInput from '../components/ScanInput';
import ErrorPopup from '../components/ErrorPopup';
import PagedList from '../components/PagedList';
import useScreenError from '../hooks/useScreenError';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import ScreenHeader from '../components/ScreenHeader';
import { colors, fonts, radii, screenStyles, buttonStyles, modalStyles, listStyles, doneStyles } from '../theme/styles';
import { useLocale } from '../i18n/locale.js';
import { getExpiryStatus } from '../utils/expiryStatus';

export default function PutAwayScreen({ navigation, route }) {
  const { warehouseId } = useAuth();
  const { t } = useLocale();
  const scrollRef = React.useRef(null);
  useScrollToTop(scrollRef);

  // Phase: 'load' → 'process' → 'done'
  const [phase, setPhase] = useState('load');

  // Load phase: queue of items to put away
  const [queue, setQueue] = useState([]);
  const { error, scanDisabled, showError, clearError } = useScreenError();

  // Process phase: selected item for put-away
  const [activeItem, setActiveItem] = useState(null);
  const [preferredBin, setPreferredBin] = useState(null);
  const [scannedBin, setScannedBin] = useState(null);
  const [putQty, setPutQty] = useState('');
  const [processPhase, setProcessPhase] = useState('scan_pallet'); // scan_pallet | scan_bin | enter_qty
  const [scannedPalletCode, setScannedPalletCode] = useState('');

  // Track qty field focus to suppress scan input auto-refocus (#13)
  const [qtyFocused, setQtyFocused] = useState(false);

  // Preferred bin prompt
  const [showPreferredPrompt, setShowPreferredPrompt] = useState(false);
  const [promptData, setPromptData] = useState(null);

  // Session history
  const [history, setHistory] = useState([]);

  // --- Load Phase ---

  const handleScanItem = async (barcode) => {
    // Check for staging bin scan first.
    // Both 'Staging' and 'PickableStaging' bin types are valid putaway
    // sources -- mirrors ReceiveScreen.js which accepts the same set.
    try {
      const binResp = await client.get(`/api/lookup/bin/${encodeURIComponent(barcode)}`);
      if (binResp.data?.bin) {
        const bin = binResp.data.bin;
        if (bin.bin_type === 'Staging' || bin.bin_type === 'PickableStaging') {
          // Load all items from this staging bin
          const items = binResp.data.items || [];
          if (items.length === 0) {
            showError(t('putaway.err.stagingEmpty'));
            return;
          }
          const newEntries = items
            .filter((it) => !queue.find((q) => q.item_id === it.item_id && q.from_bin_id === bin.bin_id))
            .map((it) => ({
              item_id: it.item_id,
              sku: it.sku,
              item_name: it.item_name,
              upc: it.upc,
              from_bin_id: bin.bin_id,
              from_bin_code: bin.bin_code,
              quantity: it.quantity_on_hand,
              lot_number: it.lot_number || null,
              expiry_date: it.expiry_date || null,
              pallet_id: it.pallet_id || null,
              pallet_code: it.pallet_code || null,
            }));
          if (newEntries.length === 0) {
            showError(t('putaway.err.allLoaded'));
            return;
          }
          setQueue((prev) => [...prev, ...newEntries]);
          return;
        }
      }
    } catch {
      // Not a bin, try as item
    }

    // Item scan
    try {
      const itemResp = await client.get(`/api/lookup/item/${encodeURIComponent(barcode)}`);
      if (!itemResp.data?.item) {
        showError(t('putaway.err.itemNotFound'));
        return;
      }

      const scannedItem = itemResp.data.item;
      const locations = itemResp.data.locations || [];
      const stagingLoc = locations.find(
        (l) => l.bin_type === 'Staging' || l.bin_type === 'PickableStaging'
      );

      if (!stagingLoc) {
        showError(t('putaway.err.notInStaging'));
        return;
      }

      // Duplicate check
      if (queue.find((q) => q.item_id === scannedItem.item_id && q.from_bin_id === stagingLoc.bin_id)) {
        showError(t('putaway.err.alreadyAdded'));
        return;
      }

      setQueue((prev) => [...prev, {
        item_id: scannedItem.item_id,
        sku: scannedItem.sku,
        item_name: scannedItem.item_name,
        upc: scannedItem.upc,
        from_bin_id: stagingLoc.bin_id,
        from_bin_code: stagingLoc.bin_code,
        quantity: stagingLoc.quantity_on_hand,
        lot_number: stagingLoc.lot_number || null,
        expiry_date: stagingLoc.expiry_date || null,
        pallet_id: stagingLoc.pallet_id || null,
        pallet_code: stagingLoc.pallet_code || null,
      }]);
    } catch {
      showError(t('putaway.err.itemNotFound'));
    }
  };

  const removeFromQueue = (index) => {
    setQueue((prev) => prev.filter((_, i) => i !== index));
  };

  const handleLoadAll = async () => {
    if (queue.length === 0) return;
    setPhase('process');
  };

  // --- Process Phase ---

  const selectItem = async (entry) => {
    setActiveItem(entry);
    setScannedBin(null);
    setScannedPalletCode('');
    setPutQty(String(entry.quantity));
    setProcessPhase(entry.pallet_id ? 'scan_pallet' : 'scan_bin');
    const expiryStatus = getExpiryStatus(entry.expiry_date);
    if (expiryStatus?.level === 'expired') {
      showError(t('putaway.err.palletExpired', { label: expiryStatus.label }));
    } else if (expiryStatus?.level === 'near') {
      showError(t('putaway.err.expiryWarning', { date: entry.expiry_date, label: expiryStatus.label }));
    }

    // Get preferred bin suggestion
    try {
      const suggestResp = await client.get(`/api/putaway/suggest/${entry.item_id}`);
      setPreferredBin(suggestResp.data.preferred_bin || suggestResp.data.suggested_bin || null);
    } catch {
      setPreferredBin(null);
    }
  };

  // Handle scan during process phase  -  match to a queue item or a bin
  const handleProcessScan = async (barcode) => {
    if (!activeItem) {
      // No item selected  -  try to match a queue item by barcode
      const match = queue.find((q) => q.upc === barcode || q.sku === barcode);
      if (match) {
        await selectItem(match);
        return;
      }
      showError(t('putaway.err.scanFromList'));
      return;
    }
    // Active item selected — route scan by phase
    if (processPhase === 'scan_pallet') {
      await handleScanPallet(barcode);
      return;
    }
    await handleScanBin(barcode);
  };

  const handleScanPallet = async (barcode) => {
    const expected = (activeItem.pallet_code || '').trim();
    if (!expected) {
      setProcessPhase('scan_bin');
      return;
    }
    if (barcode.trim().toUpperCase() !== expected.toUpperCase()) {
      showError(t('putaway.err.palletMismatch', { code: expected }));
      return;
    }
    setScannedPalletCode(barcode.trim());
    setProcessPhase('scan_bin');
  };

  const handleScanBin = async (barcode) => {
    try {
      const binResp = await client.get(`/api/lookup/bin/${encodeURIComponent(barcode)}`);
      if (!binResp.data?.bin) {
        showError(t('putaway.err.binNotFound'));
        return;
      }
      setScannedBin(binResp.data.bin);
      setProcessPhase('enter_qty');
    } catch {
      showError(t('putaway.err.binNotFound'));
    }
  };

  const handleConfirmPutAway = async () => {
    const qty = parseInt(putQty, 10);
    if (!qty || qty <= 0) return;

    try {
      await client.post('/api/putaway/confirm', {
        item_id: activeItem.item_id,
        from_bin_id: activeItem.from_bin_id,
        to_bin_id: scannedBin.bin_id,
        quantity: qty,
        lot_number: activeItem.lot_number,
        pallet_id: activeItem.pallet_id,
        pallet_code: activeItem.pallet_code || scannedPalletCode || null,
        warehouse_id: warehouseId,
      });

      setHistory((prev) => [...prev, {
        sku: activeItem.sku,
        item_name: activeItem.item_name,
        bin_code: scannedBin.bin_code,
        quantity: qty,
      }]);

      // Update remaining qty in queue (don't remove until fully shelved)
      const putAwayItemId = activeItem.item_id;
      const putAwayFromBin = activeItem.from_bin_id;
      setQueue((prev) => prev.map((q) => {
        if (q.item_id === putAwayItemId && q.from_bin_id === putAwayFromBin) {
          const remaining = q.quantity - qty;
          return { ...q, quantity: remaining, fullyPutAway: remaining <= 0 };
        }
        return q;
      }));

      // Check preferred bin
      const matchesPreferred = preferredBin && scannedBin.bin_id === preferredBin.bin_id;
      if (matchesPreferred) {
        finishItem();
      } else if (!preferredBin) {
        setPromptData({ type: 'set_new', item: activeItem, newBin: scannedBin, oldBin: null });
        setShowPreferredPrompt(true);
      } else {
        setPromptData({ type: 'change', item: activeItem, newBin: scannedBin, oldBin: preferredBin });
        setShowPreferredPrompt(true);
      }
    } catch (err) {
      showError(err.response?.data?.error || t('putaway.err.failed'));
    }
  };

  const finishItem = () => {
    setActiveItem(null);
    setPreferredBin(null);
    setScannedBin(null);
    setScannedPalletCode('');
    setProcessPhase('scan_pallet');
  };

  const handleUpdatePreferred = async () => {
    if (!promptData) return;
    try {
      await client.post('/api/putaway/update-preferred', {
        item_id: promptData.item.item_id,
        bin_id: promptData.newBin.bin_id,
        set_as_primary: true,
      });
    } catch (err) {
      // A staging / non-Pickable bin is rejected as a preferred
      // bin. Surface the reason instead of swallowing it, so the
      // operator knows the bin was NOT set as preferred (and why)
      // rather than assuming it stuck.
      showError(err.response?.data?.error || t('putaway.err.preferredFailed'));
    }
    setShowPreferredPrompt(false);
    setPromptData(null);
    finishItem();
  };

  const handleSkipPreferred = () => {
    setShowPreferredPrompt(false);
    setPromptData(null);
    finishItem();
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader
        title={t('putaway.title')}
        onBack={() => {
          if (phase === 'process' && activeItem) {
            // Back from item detail to queue list
            setActiveItem(null); setPreferredBin(null); setScannedBin(null); setProcessPhase('scan_bin'); setQtyFocused(false);
          } else if (phase === 'process') {
            // Back from queue list to load phase
            setPhase('load');
          } else {
            navigation.goBack();
          }
        }}
        right={
          phase === 'load' && queue.length > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{queue.length}</Text>
            </View>
          ) : phase === 'process' ? (
            <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted }}>
              {t('putaway.left', { count: queue.length })}
            </Text>
          ) : history.length > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{history.length}</Text>
            </View>
          ) : undefined
        }
      />

      {/* Load Phase */}
      {phase === 'load' && (
        <>
          <View style={screenStyles.content}>
            <View style={{ padding: 16, paddingBottom: 0 }}>
              <ScanInput placeholder={t('putaway.scan.itemOrStaging')} onScan={handleScanItem} disabled={scanDisabled} />
            </View>

            <View style={{ flex: 1, paddingHorizontal: 16 }}>
              <PagedList
                items={queue}
                pageSize={20}
                renderItem={(entry, index) => (
                  <View style={[listStyles.row, { padding: 14 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.queueSku}>{entry.sku}</Text>
                      <Text style={styles.queueDetail}>
                        {t('putaway.queueDetail', { name: entry.item_name, qty: entry.quantity, bin: entry.from_bin_code })}
                        {entry.pallet_code ? ` · ${entry.pallet_code}` : ''}
                      </Text>
                      {entry.expiry_date && getExpiryStatus(entry.expiry_date)?.level !== 'ok' ? (
                        <Text style={[
                          styles.expiryWarning,
                          getExpiryStatus(entry.expiry_date)?.level === 'expired' && styles.expiryDanger,
                        ]}>
                          {t('putaway.expiryLine', { date: entry.expiry_date, label: getExpiryStatus(entry.expiry_date)?.label })}
                        </Text>
                      ) : null}
                    </View>
                    <TouchableOpacity style={listStyles.removeBtn} onPress={() => removeFromQueue(index)}>
                      <Text style={listStyles.removeText}>X</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            </View>

            <View style={screenStyles.bottomBar}>
              <TouchableOpacity
                style={[buttonStyles.buttonPrimary, { flex: 1 }, queue.length === 0 && buttonStyles.buttonDisabled]}
                onPress={handleLoadAll}
                disabled={queue.length === 0}
              >
                <Text style={buttonStyles.buttonPrimaryText}>{t('putaway.btn.loadAll')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {/* Process Phase */}
      {phase === 'process' && (
        <>
          {/* Active item detail  -  scrollable for small screens */}
          {activeItem ? (
            <ScrollView ref={scrollRef} style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
              <ScanInput
                placeholder={
                  processPhase === 'scan_pallet'
                    ? t('putaway.scan.pallet')
                    : processPhase === 'scan_bin'
                      ? t('putaway.scan.destBin')
                      : t('putaway.scan.bin')
                }
                onScan={handleProcessScan}
                disabled={scanDisabled}
                suppressRefocus={qtyFocused}
              />

              <View style={styles.itemCard}>
                <Text style={styles.itemName}>{activeItem.item_name}</Text>
                <Text style={styles.sku}>{activeItem.sku}</Text>
                <Text style={styles.fromBin}>{t('putaway.fromLine', { bin: activeItem.from_bin_code, qty: activeItem.quantity })}</Text>
                {activeItem.pallet_code ? (
                  <Text style={styles.fromBin}>
                    {t('putaway.palletLine', { code: activeItem.pallet_code })}
                    {scannedPalletCode ? ' ✓' : processPhase === 'scan_pallet' ? ` ${t('putaway.scanToConfirm')}` : ''}
                  </Text>
                ) : null}
                {activeItem.expiry_date && getExpiryStatus(activeItem.expiry_date)?.level !== 'ok' ? (
                  <View style={[
                    styles.expiryBanner,
                    getExpiryStatus(activeItem.expiry_date)?.level === 'expired' && styles.expiryBannerDanger,
                  ]}>
                    <Text style={[
                      styles.expiryBannerText,
                      getExpiryStatus(activeItem.expiry_date)?.level === 'expired' && styles.expiryDanger,
                    ]}>
                      {t('putaway.expiryLine', { date: activeItem.expiry_date, label: getExpiryStatus(activeItem.expiry_date)?.label })}
                    </Text>
                  </View>
                ) : null}
              </View>

              {preferredBin ? (
                <View style={styles.suggestCard}>
                  <Text style={styles.suggestLabel}>{t('putaway.label.suggestedBin')}</Text>
                  <Text style={styles.suggestBinCode}>{preferredBin.bin_code}</Text>
                  {preferredBin.zone_name && (
                    <Text style={styles.suggestZone}>{preferredBin.zone_name}</Text>
                  )}
                </View>
              ) : processPhase === 'scan_bin' ? (
                <View style={styles.noPreferredCard}>
                  <Text style={styles.noPreferredText}>{t('putaway.noPreferred')}</Text>
                  <Text style={styles.noPreferredSub}>{t('putaway.scanAnyBin')}</Text>
                </View>
              ) : null}

              {processPhase === 'enter_qty' && scannedBin && (
                <View style={styles.confirmCard}>
                  <Text style={styles.confirmLabel}>{t('putaway.label.destination')}</Text>
                  <Text style={styles.confirmBinCode}>{scannedBin.bin_code}</Text>
                  <View style={styles.qtyRow}>
                    <Text style={styles.qtyLabel}>{t('putaway.label.quantity')}</Text>
                    <TextInput
                      style={listStyles.qtyInput}
                      value={putQty}
                      onChangeText={setPutQty}
                      keyboardType="number-pad"
                      placeholderTextColor={colors.textPlaceholder}
                      onFocus={() => setQtyFocused(true)}
                      onBlur={() => setQtyFocused(false)}
                    />
                  </View>
                  <TouchableOpacity style={buttonStyles.buttonPrimary} onPress={handleConfirmPutAway}>
                    <Text style={buttonStyles.buttonPrimaryText}>{t('putaway.btn.confirm')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[buttonStyles.buttonSecondary, { marginTop: 8 }]}
                    onPress={() => { setScannedBin(null); setProcessPhase('scan_bin'); }}
                  >
                    <Text style={buttonStyles.buttonSecondaryText}>{t('putaway.btn.scanOther')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              <TouchableOpacity
                style={[buttonStyles.buttonSecondary, { marginTop: 4 }]}
                onPress={() => { setActiveItem(null); setPreferredBin(null); setScannedBin(null); setProcessPhase('scan_bin'); }}
              >
                <Text style={buttonStyles.buttonSecondaryText}>{t('putaway.btn.backToList')}</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            /* Queue list  -  tap any item to select */
            <View style={screenStyles.content}>
              <View style={{ padding: 16, paddingBottom: 0 }}>
                <ScanInput
                  placeholder={t('putaway.scan.item')}
                  onScan={handleProcessScan}
                  disabled={scanDisabled}
                />
              </View>
              <View style={{ flex: 1, paddingHorizontal: 16 }}>
                <PagedList
                  items={queue}
                  pageSize={20}
                  renderItem={(entry) => (
                    <TouchableOpacity
                      style={[listStyles.row, { padding: 14 }, entry.fullyPutAway && { borderColor: colors.success }]}
                      onPress={() => !entry.fullyPutAway && selectItem(entry)}
                      activeOpacity={entry.fullyPutAway ? 1 : 0.7}
                      disabled={entry.fullyPutAway}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.queueSku, entry.fullyPutAway && { color: colors.success }]}>{entry.sku}</Text>
                        <Text style={styles.queueDetail}>
                          {t('putaway.queueDetail', { name: entry.item_name, qty: entry.fullyPutAway ? 0 : entry.quantity, bin: entry.from_bin_code })}
                        </Text>
                      </View>
                      {entry.fullyPutAway && (
                        <Text style={{ fontSize: 18, color: colors.success }}>{'\u2713'}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                />
              </View>
            </View>
          )}

          <View style={screenStyles.bottomBar}>
            {(() => {
              const remaining = queue.filter((q) => !q.fullyPutAway);
              const allDone = remaining.length === 0;
              return (
                <TouchableOpacity
                  style={[buttonStyles.buttonPrimary, { flex: 1 }, !allDone && buttonStyles.buttonDisabled]}
                  onPress={() => { if (allDone) setPhase('done'); }} // i18n-ignore
                  disabled={!allDone}
                >
                  <Text style={buttonStyles.buttonPrimaryText}>
                    {allDone ? t('putaway.btn.finish') : t('putaway.btn.remaining', { count: remaining.length })}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </>
      )}

      {/* Done Phase */}
      {phase === 'done' && (
        <ScrollView
          style={screenStyles.content}
          contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, paddingBottom: 32 }}
        >
          <Text style={doneStyles.check}>{'\u2713'}</Text>
          <Text style={doneStyles.title}>{t('putaway.complete')}</Text>
          <Text style={[doneStyles.detail, { marginBottom: 16 }]}>
            {t(history.length === 1 ? 'putaway.doneCount.one' : 'putaway.doneCount.other', { count: history.length })}
          </Text>

          {history.length > 0 && (
            <Text style={styles.sessionHistoryLabel}>{t('putaway.sessionHistory')}</Text>
          )}

          {history.map((h, i) => (
            <View key={i} style={styles.historyRow}>
              <Text style={styles.historyCheck}>{'\u2713'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.historySku}>{h.sku}</Text>
                <Text style={styles.historyDetail}>{h.item_name}</Text>
              </View>
              <Text style={styles.historyBin}>{'\u2192'} {h.bin_code}</Text>
            </View>
          ))}

          <TouchableOpacity style={[buttonStyles.buttonPrimary, { marginTop: 24, width: '100%' }]} onPress={() => { setPhase('load'); /* i18n-ignore */ setQueue([]); }}>
            <Text style={buttonStyles.buttonPrimaryText}>{t('putaway.btn.more')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[buttonStyles.buttonSecondary, { marginTop: 8, width: '100%' }]} onPress={() => navigation.goBack()}>
            <Text style={buttonStyles.buttonSecondaryText}>{t('putaway.btn.done')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Preferred bin prompt modal */}
      <Modal visible={showPreferredPrompt} transparent animationType="fade">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            {promptData?.type === 'set_new' ? (
              <>
                <Text style={styles.modalTitle}>{t('putaway.modal.title')}</Text>
                <Text style={styles.modalItemName}>{promptData.item.item_name}</Text>
                <Text style={styles.modalSku}>{promptData.item.sku}</Text>
                <View style={modalStyles.divider} />
                <Text style={modalStyles.body}>
                  {t('putaway.modal.setNew', { bin: promptData.newBin.bin_code })}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>{t('putaway.modal.title')}</Text>
                <Text style={styles.modalItemName}>{promptData?.item?.item_name}</Text>
                <Text style={styles.modalSku}>{promptData?.item?.sku}</Text>
                <View style={modalStyles.divider} />
                <Text style={modalStyles.body}>
                  {t('putaway.modal.change', { from: promptData?.oldBin?.bin_code, to: promptData?.newBin?.bin_code })}
                </Text>
              </>
            )}

            <View style={modalStyles.actions}>
              <TouchableOpacity style={[buttonStyles.buttonPrimary, { flex: 1 }]} onPress={handleUpdatePreferred}>
                <Text style={buttonStyles.buttonPrimaryText}>
                  {promptData?.type === 'set_new' ? t('putaway.btn.yes') : t('putaway.btn.update')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={[buttonStyles.buttonSecondary, { flex: 1 }]} onPress={handleSkipPreferred}>
                <Text style={buttonStyles.buttonSecondaryText}>
                  {promptData?.type === 'set_new' ? t('putaway.btn.skip') : t('putaway.btn.keep')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ErrorPopup
        visible={!!error}
        message={error}
        onDismiss={clearError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Header extras
  badge: {
    backgroundColor: colors.copper, borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2, minWidth: 24, alignItems: 'center',
  },
  badgeText: { color: colors.background, fontFamily: fonts.mono, fontSize: 12, fontWeight: '700' },

  // Load phase
  queueSku: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  queueDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  expiryWarning: {
    fontFamily: fonts.mono, fontSize: 10, fontWeight: '700',
    color: colors.warning, marginTop: 5,
  },
  expiryDanger: { color: colors.danger },

  // Process phase
  itemCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    padding: 8, marginBottom: 6,
  },
  itemName: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  sku: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '600', color: colors.textMuted, marginTop: 1 },
  fromBin: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  expiryBanner: {
    alignSelf: 'flex-start', marginTop: 7, paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: radii.badge, borderWidth: 1, borderColor: colors.warning,
    backgroundColor: colors.warningBg,
  },
  expiryBannerDanger: { borderColor: colors.danger, backgroundColor: colors.accentBg },
  expiryBannerText: {
    fontFamily: fonts.mono, fontSize: 10, fontWeight: '700', color: colors.accent,
  },

  suggestCard: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.copper, borderRadius: 0,
    padding: 6, marginBottom: 6, alignItems: 'center',
  },
  suggestLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3, marginBottom: 1 },
  suggestBinCode: { fontFamily: fonts.mono, fontSize: 20, fontWeight: '700', color: colors.copper },
  suggestZone: { fontFamily: fonts.mono, fontSize: 10, color: colors.copper, letterSpacing: 0.3, marginTop: 1, textTransform: 'uppercase' },

  noPreferredCard: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.copper, borderRadius: 0,
    padding: 6, marginBottom: 6, alignItems: 'center',
  },
  noPreferredText: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  noPreferredSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  confirmCard: {
    borderWidth: 1, borderColor: colors.success, borderRadius: radii.card,
    padding: 10, marginTop: 4,
  },
  confirmLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3, marginBottom: 2 },
  confirmBinCode: { fontFamily: fonts.mono, fontSize: 20, fontWeight: '700', color: colors.success, marginBottom: 8 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  qtyLabel: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },

  // Session history
  sessionHistoryLabel: {
    fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted,
    letterSpacing: 1, alignSelf: 'flex-start', marginBottom: 8, marginTop: 8,
  },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', width: '100%',
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.small,
    padding: 12, marginBottom: 6, minHeight: 48,
  },
  historyCheck: { fontSize: 16, color: colors.success, marginRight: 10 },
  historySku: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  historyDetail: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  historyBin: { fontFamily: fonts.mono, fontSize: 13, fontWeight: '700', color: colors.textPrimary },

  // Modal (screen-specific)
  modalTitle: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },
  modalItemName: { fontSize: 16, fontWeight: '600', color: colors.textPrimary, marginTop: 4 },
  modalSku: { fontFamily: fonts.mono, fontSize: 14, color: colors.textMuted, marginTop: 2 },
});
