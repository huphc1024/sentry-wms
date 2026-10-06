import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, TouchableOpacity, TextInput, ScrollView, Modal, ActivityIndicator, StyleSheet } from 'react-native';
import ScanInput from '../components/ScanInput';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import client from '../api/client';
import { useLocale } from '../i18n/locale.js';
import { colors, fonts, radii, screenStyles, buttonStyles, modalStyles } from '../theme/styles';

export default function PickWalkScreen({ navigation, route }) {
  const { t } = useLocale();
  const { batch_id, batch } = route.params;
  const [task, setTask] = useState(null);
  const [scannedCount, setScannedCount] = useState(0);
  const [pickNumber, setPickNumber] = useState(0);
  const [totalPicks, setTotalPicks] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);

  const { error, scanDisabled, showError, clearError } = useScreenError();
  const [showShortModal, setShowShortModal] = useState(false);
  const [shortQty, setShortQty] = useState('0');
  const [roundComplete, setRoundComplete] = useState(false);
  const [allTasks, setAllTasks] = useState([]);
  const [taskList, setTaskList] = useState([]);
  const [showEarlySubmit, setShowEarlySubmit] = useState(false);
  const [showItemDetail, setShowItemDetail] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [batchComplete, setBatchComplete] = useState(false);

  useEffect(() => {
    if (batch) {
      setTotalPicks(batch.total_picks || 0);
      setTotalOrders(batch.total_orders || 0);
    }
    loadNextTask();
    loadTaskList();
  }, []);

  // Coming back from the 3D view (or the 2D map): refresh the task list.
  // The re-render also re-registers this screen's ScanInput as the
  // hardware-scan handler, which the pushed screen's own ScanInput took.
  const focusCount = useRef(0);
  useFocusEffect(useCallback(() => {
    focusCount.current += 1;
    if (focusCount.current > 1) loadTaskList();
  }, []));

  const loadTaskList = () => {
    client.get(`/api/picking/batch/${batch_id}`)
      .then((resp) => setTaskList(resp.data.tasks || []))
      .catch(() => {});
  };

  const loadNextTask = async () => {
    try {
      const resp = await client.get(`/api/picking/batch/${batch_id}/next`);
      if (resp.data.message === 'All tasks complete') {
        setTask(null);
        setRoundComplete(true);
        // Auto-submit the batch so user goes straight to the completion screen
        try {
          await client.post('/api/picking/complete-batch', { batch_id });
        } catch {
          // Batch may already be complete
        }
        setBatchComplete(true);
        return;
      }
      setTask(resp.data);
      setScannedCount(0);
      setPickNumber(resp.data.pick_number || pickNumber + 1);
      if (resp.data.total_picks) setTotalPicks(resp.data.total_picks);
      if (resp.data.total_orders) setTotalOrders(resp.data.total_orders);
      // Refresh task list so next-item preview has current statuses
      loadTaskList();
    } catch (err) {
      showError(err.response?.data?.error || t('pick.loadNextFailed'));
    }
  };

  const handleScan = async (barcode) => {
    if (!task) return;

    const expected = task.pallet_code || task.pallet_barcode;
    const valid = expected
      ? barcode === task.pallet_code || barcode === task.pallet_barcode
      : barcode === (task.upc || '') || barcode === (task.sku || '');
    if (!valid) {
      showError(expected
        ? t('pick.wrongPallet', { code: task.pallet_code })
        : t('pick.wrongItem', { sku: task.sku }));
      return;
    }

    const newCount = expected ? task.quantity_to_pick : scannedCount + 1;
    const qtyNeeded = task.quantity_to_pick;

    if (newCount >= qtyNeeded) {
      try {
        await client.post('/api/picking/confirm', {
          pick_task_id: task.pick_task_id,
          scanned_barcode: barcode,
          quantity_picked: qtyNeeded,
        });
        setScannedCount(0);
        await loadNextTask();
      } catch (err) {
        showError(err.response?.data?.error || t('pick.pickFailed'));
      }
    } else {
      setScannedCount(newCount);
    }
  };

  const handleShort = async () => {
    if (!task) return;
    const qty = parseInt(shortQty, 10);
    if (isNaN(qty) || qty < 0) return;

    try {
      await client.post('/api/picking/short', {
        pick_task_id: task.pick_task_id,
        quantity_available: qty,
      });
      setShowShortModal(false);
      setShortQty('0');
      setScannedCount(0);
      await loadNextTask();
    } catch (err) {
      setShowShortModal(false);
      showError(err.response?.data?.error || t('pick.shortPickFailed'));
    }
  };

  const handleSubmit = async () => {
    if (!roundComplete) {
      try {
        const resp = await client.get(`/api/picking/batch/${batch_id}`);
        const tasks = resp.data.tasks || [];
        const pending = tasks.filter((t) => t.status === 'PENDING');
        if (pending.length > 0) {
          setAllTasks(pending);
          setShowEarlySubmit(true);
          return;
        }
      } catch {
        // If we can't fetch tasks, just submit
      }
    }
    doSubmit();
  };

  const doSubmit = async () => {
    try {
      await client.post('/api/picking/complete-batch', { batch_id });
    } catch {
      // Batch may already be complete  -  proceed to done state
    }
    setBatchComplete(true);
  };

  const handleCancel = () => {
    setShowCancelModal(true);
  };

  const contributingOrders = task?.contributing_orders || [];

  // Peek at the next PENDING task after the current one in pick sequence
  const nextTask = (() => {
    if (!task || taskList.length === 0) return null;
    const currentIdx = taskList.findIndex((t) => t.pick_task_id === task.pick_task_id);
    if (currentIdx === -1) return null;
    // Search forward for the next PENDING task
    for (let i = currentIdx + 1; i < taskList.length; i++) {
      if (taskList[i].status === 'PENDING') return taskList[i];
    }
    return null;
  })();
  const isLastItem = task && taskList.length > 0 && !nextTask;

  return (
    <View style={screenStyles.screen}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>
            {t('pick.itemOf', { n: pickNumber, total: totalPicks })}
          </Text>
          <View style={styles.headerOrderRow}>
            {/* v1.8.0 (#295) header swap: TO batches surface the TO
                number; SO batches keep the existing "X orders"
                count. task.to_number is set by the picking_service
                discriminator branch when the active task is a TO
                pick. */}
            <Text style={styles.headerOrders}>
              {task && task.to_number
                ? t('pick.toNumber', { number: task.to_number })
                : t(totalOrders !== 1 ? 'pick.orders_other' : 'pick.orders_one', { count: totalOrders })}
            </Text>
            <View style={styles.greenDot} />
          </View>
        </View>
      </View>

      {batchComplete ? (
        <View style={styles.roundComplete}>
          <Text style={styles.roundCompleteCheck}>{'\u2713'}</Text>
          <Text style={styles.roundCompleteText}>{t('pick.roundComplete')}</Text>
          <Text style={styles.roundCompleteDetail}>
            {t('pick.readyForPacking', { orders: t(totalOrders !== 1 ? 'pick.orders_other' : 'pick.orders_one', { count: totalOrders }) })}
          </Text>
          <View style={styles.completeSummary}>
            <View style={styles.completeSummaryRow}>
              <Text style={styles.completeSummaryLabel}>{t('pick.totalPicks')}</Text>
              <Text style={styles.completeSummaryValue}>{totalPicks}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={[buttonStyles.buttonPrimary, { width: '100%', marginBottom: 12 }]}
            onPress={() => navigation.replace('PickScan')}
          >
            <Text style={buttonStyles.buttonPrimaryText}>{t('pick.startNewBatch')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[buttonStyles.buttonSecondary, { width: '100%' }]}
            onPress={() => navigation.navigate('Home')}
          >
            <Text style={buttonStyles.buttonSecondaryText}>{t('pick.done')}</Text>
          </TouchableOpacity>
        </View>
      ) : !task ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <ScrollView style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
          {/* Bin hero card */}
          <View style={styles.binCard}>
            <Text style={styles.binLabel}>{t('pick.goToBin')}</Text>
            <Text style={styles.binCode}>{task.bin_code}</Text>
            {task.zone_name && (
              <Text style={styles.binZone}>
                {task.zone_name}{task.aisle ? t('pick.aisleSuffix', { aisle: task.aisle }) : ''}
              </Text>
            )}
            <Text style={styles.binLocation}>
              {task.rack_label || task.bin_code} · {task.slot_label || 'L1-P1'}
            </Text>
            {task.pallet_code ? (
              <>
                <Text style={styles.palletCode}>{t('pick.palletLabel', { code: task.pallet_code })}</Text>
                <Text style={styles.palletMeta}>
                  {task.lot_code ? t('pick.lotLabel', { code: task.lot_code }) : t('pick.noLot')}
                  {task.expiry_date ? t('pick.expirySuffix', { date: task.expiry_date }) : ''}
                </Text>
              </>
            ) : null}
            <TouchableOpacity
              style={[buttonStyles.buttonSecondary, { marginTop: 12, width: '100%' }]}
              onPress={() => navigation.navigate('Map', {
                itemId: task.item_id,
                sku: task.sku,
              })}
            >
              <Text style={buttonStyles.buttonSecondaryText}>{t('pick.viewOnMap')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[buttonStyles.buttonSecondary, { marginTop: 8, width: '100%' }]}
              onPress={() => navigation.navigate('Warehouse3D', {
                batchId: batch_id,
                currentTaskId: task.pick_task_id,
                tasks: taskList,
              })}
            >
              <Text style={buttonStyles.buttonSecondaryText}>{t('pick.view3d')}</Text>
            </TouchableOpacity>
          </View>

          {/* Item card */}
          <TouchableOpacity
            style={styles.itemCard}
            onPress={() => setShowItemDetail(true)}
            activeOpacity={0.7}
          >
            <View style={styles.itemCardInner}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLabel}>{t('pick.item')}</Text>
                <Text style={styles.sku}>{task.sku}</Text>
                <Text style={styles.itemName}>{task.item_name}</Text>
              </View>
              <View style={styles.qtySection}>
                <Text style={styles.itemLabel}>{t('pick.qty')}</Text>
                <Text style={styles.qty}>{task.quantity_to_pick}</Text>
              </View>
            </View>

            {task.quantity_to_pick > 1 && (
              <>
                <View style={styles.itemDivider} />
                <View style={styles.scanProgress}>
                  <Text style={styles.scanProgressLabel}>{t('pick.scanned')}</Text>
                  <Text style={styles.scanProgressCount}>
                    {scannedCount} / {task.quantity_to_pick}
                  </Text>
                  <View style={styles.progressBar}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${(scannedCount / task.quantity_to_pick) * 100}%` },
                      ]}
                    />
                  </View>
                </View>
              </>
            )}
          </TouchableOpacity>

          {/* Next item preview */}
          {taskList.length > 0 && (nextTask ? (
            <View style={styles.nextCard}>
              <Text style={styles.nextLabel}>{t('pick.next')}</Text>
              <Text style={styles.nextSku}>{nextTask.sku}</Text>
              <Text style={styles.nextName}>{nextTask.item_name}</Text>
              <View style={styles.nextBinRow}>
                <Text style={styles.nextBinLabel}>{t('pick.bin')}</Text>
                <Text style={styles.nextBinCode}>{nextTask.bin_code}</Text>
              </View>
            </View>
          ) : isLastItem ? (
            <View style={styles.nextCard}>
              <Text style={styles.lastItemText}>{t('pick.lastItem')}</Text>
            </View>
          ) : null)}

          {/* Scan input */}
          <ScanInput
            placeholder={task.pallet_code ? t('pick.scanPalletQr') : t('pick.scanItem')}
            onScan={handleScan}
            disabled={scanDisabled}
          />

          {/* Short pick */}
          <TouchableOpacity
            onPress={() => {
              setShortQty('0');
              setShowShortModal(true);
            }}
          >
            <Text style={styles.shortPickText}>{t('pick.shortPick')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Bottom buttons */}
      {!batchComplete && (
        <View style={screenStyles.bottomBar}>
          <TouchableOpacity style={[buttonStyles.buttonPrimary, { flex: 1 }]} onPress={handleSubmit}>
            <Text style={buttonStyles.buttonPrimaryText}>{t('pick.submit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[buttonStyles.buttonSecondary, { flex: 1 }]} onPress={handleCancel}>
            <Text style={buttonStyles.buttonSecondaryText}>{t('pick.cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Short pick modal */}
      <Modal visible={showShortModal} transparent animationType="fade">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>{t('pick.shortPick')}</Text>
            <Text style={modalStyles.subtitle}>
              {t('pick.expectedEnterQty', { qty: task?.quantity_to_pick })}
            </Text>
            <TextInput
              style={styles.shortInput}
              value={shortQty}
              onChangeText={setShortQty}
              keyboardType="number-pad"
              autoFocus
            />
            <View style={modalStyles.actions}>
              <TouchableOpacity style={[buttonStyles.buttonPrimary, { flex: 1 }]} onPress={handleShort}>
                <Text style={buttonStyles.buttonPrimaryText}>{t('pick.confirm')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[buttonStyles.buttonSecondary, { flex: 1 }]}
                onPress={() => setShowShortModal(false)}
              >
                <Text style={buttonStyles.buttonSecondaryText}>{t('pick.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Early submit warning */}
      <Modal visible={showEarlySubmit} transparent animationType="fade">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>{t('pick.incompleteBatch')}</Text>
            <Text style={modalStyles.subtitle}>
              {t('pick.confirmSubmit')}
            </Text>
            <ScrollView style={styles.earlySubmitList}>
              {allTasks.map((tk, i) => (
                <View key={i} style={styles.earlySubmitRow}>
                  <Text style={styles.earlySubmitSku}>{tk.sku || tk.item_name}</Text>
                  <Text style={styles.earlySubmitQty}>
                    {t('pick.remaining', { qty: tk.quantity_to_pick - (tk.quantity_picked || 0) })}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <View style={modalStyles.actions}>
              <TouchableOpacity style={[buttonStyles.buttonPrimary, { flex: 1 }]} onPress={() => { setShowEarlySubmit(false); doSubmit(); }}>
                <Text style={buttonStyles.buttonPrimaryText}>{t('pick.submit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[buttonStyles.buttonSecondary, { flex: 1 }]}
                onPress={() => setShowEarlySubmit(false)}
              >
                <Text style={buttonStyles.buttonSecondaryText}>{t('pick.back')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Item detail modal */}
      <Modal visible={showItemDetail} transparent animationType="fade">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>{t('pick.itemDetails')}</Text>
            {task && (
              <View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>SKU</Text>
                  <Text style={styles.detailValue}>{task.sku}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('pick.name')}</Text>
                  <Text style={styles.detailValue}>{task.item_name}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>UPC</Text>
                  <Text style={styles.detailValue}>{task.upc || '-'}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('pick.bin')}</Text>
                  <Text style={styles.detailValue}>{task.bin_code}</Text>
                </View>
                {task.zone_name && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{t('pick.zone')}</Text>
                    <Text style={styles.detailValue}>{task.zone_name}{task.aisle ? t('pick.aisleSlash', { aisle: task.aisle }) : ''}</Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('pick.qtyNeeded')}</Text>
                  <Text style={styles.detailValue}>{task.quantity_to_pick}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>{t('pick.scanned')}</Text>
                  <Text style={styles.detailValue}>{scannedCount} / {task.quantity_to_pick}</Text>
                </View>
                {contributingOrders.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.detailLabel}>{t('pick.orders')}</Text>
                    {contributingOrders.map((order, i) => (
                      <View key={i} style={styles.detailOrderRow}>
                        <Text style={styles.detailOrderSo}>{order.so_number}</Text>
                        <Text style={styles.detailOrderQty}>{order.quantity}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}
            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={[buttonStyles.buttonPrimary, { flex: 1 }]}
                onPress={async () => {
                  if (!task) return;
                  const newCount = scannedCount + 1;
                  const qtyNeeded = task.quantity_to_pick;
                  if (newCount >= qtyNeeded) {
                    try {
                      await client.post('/api/picking/confirm', {
                        pick_task_id: task.pick_task_id,
                        scanned_barcode: task.upc || task.sku,
                        quantity_picked: qtyNeeded,
                      });
                      setScannedCount(0);
                      setShowItemDetail(false);
                      await loadNextTask();
                    } catch (err) {
                      setShowItemDetail(false);
                      showError(err.response?.data?.error || t('pick.pickFailed'));
                    }
                  } else {
                    setScannedCount(newCount);
                  }
                }}
              >
                <Text style={buttonStyles.buttonPrimaryText}>{t('pick.pick')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[buttonStyles.buttonSecondary, { flex: 1 }]}
                onPress={() => setShowItemDetail(false)}
              >
                <Text style={buttonStyles.buttonSecondaryText}>{t('pick.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cancel batch modal */}
      <Modal visible={showCancelModal} transparent animationType="fade">
        <View style={modalStyles.overlay}>
          <View style={modalStyles.card}>
            <Text style={modalStyles.title}>{t('pick.cancelPickWalk')}</Text>
            <Text style={modalStyles.subtitle}>
              {t('pick.confirmCancel')}
            </Text>
            <View style={modalStyles.actions}>
              <TouchableOpacity
                style={[buttonStyles.buttonPrimary, { flex: 1 }]}
                onPress={() => { setShowCancelModal(false); navigation.navigate('Home'); }}
              >
                <Text style={buttonStyles.buttonPrimaryText}>{t('pick.cancelBatch')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[buttonStyles.buttonSecondary, { flex: 1 }]}
                onPress={() => setShowCancelModal(false)}
              >
                <Text style={buttonStyles.buttonSecondaryText}>{t('pick.back')}</Text>
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
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 52, paddingBottom: 12,
  },
  palletCode: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: '700',
    color: colors.success,
    marginTop: 8,
  },
  palletMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  binLocation: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginTop: 4,
  },
  headerLeft: {},
  headerTitle: { fontFamily: fonts.mono, fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  headerOrderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  headerOrders: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted },
  greenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success, marginLeft: 6 },

  roundComplete: {
    flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  roundCompleteCheck: { fontSize: 64, color: colors.success, marginBottom: 16 },
  roundCompleteText: { fontFamily: fonts.mono, fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  roundCompleteDetail: { fontSize: 15, color: colors.textMuted },

  binCard: {
    backgroundColor: colors.accent,
    borderRadius: radii.heroCard,
    padding: 14, marginBottom: 10, alignItems: 'center',
  },
  binLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.cream, opacity: 0.5, letterSpacing: 2, marginBottom: 4 },
  binCode: { fontFamily: fonts.mono, fontSize: 36, fontWeight: '700', color: colors.cream, letterSpacing: 3 },
  binZone: { fontFamily: fonts.mono, fontSize: 11, color: colors.cream, opacity: 0.4, letterSpacing: 0.3, marginTop: 4, textTransform: 'uppercase' },

  itemCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    padding: 12, marginBottom: 10,
  },
  itemCardInner: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  itemLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3, marginBottom: 2 },
  sku: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  itemName: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  qtySection: { alignItems: 'flex-end' },
  qty: { fontFamily: fonts.mono, fontSize: 30, fontWeight: '700', color: colors.accent },

  itemDivider: { height: 1, backgroundColor: colors.cardBorder, marginVertical: 12 },
  scanProgress: {},
  scanProgressLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted },
  scanProgressCount: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  progressBar: { height: 4, backgroundColor: colors.cardBorder, borderRadius: 2, marginTop: 8 },
  progressFill: { height: 4, backgroundColor: colors.accent, borderRadius: 2 },

  nextCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    padding: 10, marginBottom: 10,
  },
  nextLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted, letterSpacing: 1, marginBottom: 4 },
  nextSku: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  nextName: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  nextBinRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  nextBinLabel: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3, marginRight: 6 },
  nextBinCode: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '700', color: colors.accent },
  lastItemText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center', letterSpacing: 0.5 },

  shortPickText: {
    fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.copper,
    textAlign: 'center', letterSpacing: 0.5, paddingVertical: 8,
  },

  shortInput: {
    fontFamily: fonts.mono, fontSize: 24, fontWeight: '700', color: colors.textPrimary,
    borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radii.input,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 16, paddingVertical: 12, textAlign: 'center', minHeight: 48,
    marginBottom: 16,
  },
  earlySubmitList: { maxHeight: 200, marginBottom: 16 },
  earlySubmitRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  earlySubmitSku: { fontFamily: fonts.mono, fontSize: 13, color: colors.textPrimary },
  earlySubmitQty: { fontFamily: fonts.mono, fontSize: 13, color: colors.accent },

  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.cardBorder },
  detailLabel: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '600', color: colors.textMuted, letterSpacing: 0.3 },
  detailValue: { fontFamily: fonts.mono, fontSize: 13, color: colors.textPrimary, textAlign: 'right', flex: 1, marginLeft: 12 },
  detailOrderRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, paddingLeft: 8 },
  detailOrderSo: { fontFamily: fonts.mono, fontSize: 12, color: colors.textPrimary },
  detailOrderQty: { fontFamily: fonts.mono, fontSize: 12, fontWeight: '700', color: colors.accent },

  completeSummary: { width: '100%', marginBottom: 32 },
  completeSummaryRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.cardBorder,
  },
  completeSummaryLabel: { fontFamily: fonts.mono, fontSize: 13, color: colors.textMuted },
  completeSummaryValue: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
});
