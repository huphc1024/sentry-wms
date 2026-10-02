import React, { useState } from 'react';
import { useScrollToTop } from '@react-navigation/native';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet } from 'react-native';
import ScanInput from '../components/ScanInput';
import ScreenHeader from '../components/ScreenHeader';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import { useLocale } from '../i18n/locale.js';
import { colors, fonts, radii, screenStyles, buttonStyles, listStyles } from '../theme/styles';

const STEPS = ['transfer.step.item', 'transfer.step.fromBin', 'transfer.step.toBin'];

export default function TransferScreen({ navigation }) {
  const { warehouseId } = useAuth();
  const { t } = useLocale();
  const scrollRef = React.useRef(null);
  useScrollToTop(scrollRef);
  const [step, setStep] = useState(0);
  const [item, setItem] = useState(null);
  const [locations, setLocations] = useState([]);
  const [fromBin, setFromBin] = useState(null);
  const [toBin, setToBin] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const { error, scanDisabled, showError, clearError } = useScreenError();
  const [success, setSuccess] = useState(false);

  const handleScan = async (barcode) => {
    if (step === 0) {
      // Scan item
      try {
        const resp = await client.get(`/api/lookup/item/${encodeURIComponent(barcode)}`);
        if (!resp.data?.item) {
          showError(t('transfer.err.itemNotFound'));
          return;
        }
        setItem(resp.data.item);
        setLocations(resp.data.locations || []);
        setStep(1);
      } catch {
        showError(t('transfer.err.itemNotFound'));
      }
    } else if (step === 1) {
      // Scan from bin
      try {
        const resp = await client.get(`/api/lookup/bin/${encodeURIComponent(barcode)}`);
        if (!resp.data?.bin) {
          showError(t('transfer.err.binNotFound'));
          return;
        }
        const bin = resp.data.bin;
        // Check item is in this bin
        const inBin = locations.find(
          (l) => l.bin_id === bin.bin_id || l.bin_code === bin.bin_code
        );
        if (!inBin) {
          showError(t('transfer.err.itemNotInBin'));
          return;
        }
        setFromBin({ ...bin, available: inBin.quantity_on_hand });
        setQuantity('1');
        setStep(2);
      } catch {
        showError(t('transfer.err.binNotFound'));
      }
    } else if (step === 2) {
      // Scan to bin
      try {
        const resp = await client.get(`/api/lookup/bin/${encodeURIComponent(barcode)}`);
        if (!resp.data?.bin) {
          showError(t('transfer.err.binNotFound'));
          return;
        }
        setToBin(resp.data.bin);
        setStep(3);
      } catch {
        showError(t('transfer.err.binNotFound'));
      }
    }
  };

  const handleConfirm = async () => {
    const qty = parseInt(quantity, 10);
    if (!qty || qty <= 0) return;

    try {
      await client.post('/api/transfers/move', {
        item_id: item.item_id,
        from_bin_id: fromBin.bin_id,
        to_bin_id: toBin.bin_id,
        quantity: qty,
        warehouse_id: warehouseId,
      });
      setSuccess(true);
    } catch (err) {
      showError(err.response?.data?.error || t('transfer.err.failed'));
    }
  };

  const resetAll = () => {
    setStep(0);
    setItem(null);
    setLocations([]);
    setFromBin(null);
    setToBin(null);
    setQuantity('1');
    setSuccess(false);
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title={t('transfer.title')} onBack={() => navigation.goBack()} />

      <ScrollView ref={scrollRef} style={screenStyles.content} contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
        {success ? (
          <View style={styles.successSection}>
            <Text style={styles.successText}>{t('transfer.complete')}</Text>
            <Text style={styles.successDetail}>
              {t('transfer.completeDetail', { qty: quantity, sku: item?.sku, from: fromBin?.bin_code, to: toBin?.bin_code })}
            </Text>
            <TouchableOpacity style={[buttonStyles.buttonPrimary, { width: '100%' }]} onPress={resetAll}>
              <Text style={buttonStyles.buttonPrimaryText}>{t('transfer.btn.new')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[buttonStyles.buttonSecondary, { width: '100%', marginTop: 8 }]} onPress={() => navigation.goBack()}>
              <Text style={buttonStyles.buttonSecondaryText}>{t('transfer.btn.done')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* Step indicator */}
            <View style={styles.steps}>
              {STEPS.map((label, i) => (
                <View key={i} style={styles.stepItem}>
                  <View style={[styles.stepDot, i <= step && styles.stepDotActive]} />
                  <Text style={[styles.stepLabel, i === step && styles.stepLabelActive]}>{t(label)}</Text>
                </View>
              ))}
            </View>

            {/* Confirmed info */}
            {item && (
              <View style={styles.infoCard}>
                <Text style={listStyles.label}>{t('transfer.label.item')}</Text>
                <Text style={listStyles.sku}>{item.sku}</Text>
                <Text style={styles.itemName}>{item.item_name}</Text>
                {locations.length > 0 && (
                  <View style={styles.locationList}>
                    {locations.map((loc, i) => (
                      <Text key={i} style={styles.locationText}>
                        {t('transfer.onHand', { bin: loc.bin_code, qty: loc.quantity_on_hand })}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}

            {fromBin && (
              <View style={styles.infoCard}>
                <View style={styles.infoCardHeader}>
                  <Text style={listStyles.label}>{t('transfer.label.fromBin')}</Text>
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => { setFromBin(null); setToBin(null); setStep(1); }}
                  >
                    <Text style={styles.clearBtnText}>X</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.binValue}>{fromBin.bin_code}</Text>
                <Text style={styles.available}>{t('transfer.available', { qty: fromBin.available })}</Text>
              </View>
            )}

            {toBin && (
              <View style={styles.infoCard}>
                <View style={styles.infoCardHeader}>
                  <Text style={listStyles.label}>{t('transfer.label.toBin')}</Text>
                  <TouchableOpacity
                    style={styles.clearBtn}
                    onPress={() => { setToBin(null); setStep(2); }}
                  >
                    <Text style={styles.clearBtnText}>X</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.binValue}>{toBin.bin_code}</Text>
              </View>
            )}

            {/* Scan input for current step */}
            {step < 3 && (
              <ScanInput
                placeholder={t(STEPS[step])}
                onScan={handleScan}
                disabled={scanDisabled}
              />
            )}

            {/* Quantity + Confirm for step 3 */}
            {step === 3 && (
              <>
                <View style={styles.qtyRow}>
                  <Text style={listStyles.label}>{t('transfer.label.quantity')}</Text>
                  <TextInput
                    style={listStyles.qtyInput}
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="number-pad"
                  />
                </View>
                <TouchableOpacity style={buttonStyles.buttonPrimary} onPress={handleConfirm}>
                  <Text style={buttonStyles.buttonPrimaryText}>{t('transfer.btn.confirm')}</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>

      <ErrorPopup
        visible={!!error}
        message={error}
        onDismiss={clearError}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  stepItem: { alignItems: 'center', flex: 1 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.cardBorder, marginBottom: 2 },
  stepDotActive: { backgroundColor: colors.accent },
  stepLabel: { fontFamily: fonts.mono, fontSize: 8, color: colors.textMuted, letterSpacing: 0.3, textAlign: 'center' },
  stepLabelActive: { color: colors.accent, fontWeight: '700' },
  infoCard: {
    backgroundColor: colors.cardBg, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: radii.card,
    padding: 8, marginBottom: 8,
  },
  infoCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  clearBtn: {
    padding: 4, minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center',
  },
  clearBtnText: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textMuted },
  itemName: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  locationList: { marginTop: 8 },
  locationText: { fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  binValue: { fontFamily: fonts.mono, fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  available: { fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  successSection: { alignItems: 'center', paddingVertical: 24 },
  successText: { fontFamily: fonts.mono, fontSize: 18, fontWeight: '700', color: colors.success, marginBottom: 8 },
  successDetail: { fontFamily: fonts.mono, fontSize: 13, color: colors.textMuted, marginBottom: 24, textAlign: 'center' },
});
