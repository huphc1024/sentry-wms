import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import ScreenHeader from '../components/ScreenHeader';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import client from '../api/client';
import { useLocale } from '../i18n/locale.js';
import { colors, fonts, radii, screenStyles, buttonStyles, listStyles } from '../theme/styles';

export default function GateScreen({ navigation }) {
  const { warehouseId } = useAuth();
  const { t } = useLocale();
  const { error, showError, clearError } = useScreenError();
  const [sessions, setSessions] = useState([]);
  const [movementType, setMovementType] = useState('INBOUND');
  const [plate, setPlate] = useState('');
  const [driver, setDriver] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!warehouseId) return;
    try {
      const resp = await client.get('/api/gate/active', {
        params: { warehouse_id: Number(warehouseId) },
      });
      setSessions(resp.data?.sessions || []);
    } catch (err) {
      showError(err.response?.data?.error || t('gate.err.loadFailed'));
    }
  }, [warehouseId, showError, t]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const checkIn = async () => {
    if (!warehouseId) {
      showError(t('gate.err.noWarehouse'));
      return;
    }
    if (!plate.trim()) {
      showError(t('gate.err.plateRequired'));
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const body = {
        warehouse_id: Number(warehouseId),
        movement_type: movementType,
        vehicle_plate: plate.trim().toUpperCase(),
        driver_name: driver.trim() || null,
        reference_type: referenceId.trim() ? (movementType === 'INBOUND' ? 'PO' : 'SO') : null,
        reference_id: referenceId.trim() ? Number(referenceId.trim()) : null,
      };
      const resp = await client.post('/api/gate/check-in', body);
      const session = resp.data;
      setMsg(t('gate.msg.checkedIn', { plate: session.vehicle_plate }));
      setPlate('');
      setDriver('');
      setReferenceId('');
      await load();

      if (session.session?.open_receive && session.session.po_id) {
        navigation.navigate('Receive');
      } else if (session.session?.open_ship && session.session.so_id) {
        navigation.navigate('Ship');
      }
    } catch (err) {
      showError(err.response?.data?.error || t('gate.err.checkInFailed'));
    } finally {
      setBusy(false);
    }
  };

  const complete = async (movementId) => {
    setBusy(true);
    try {
      await client.post(`/api/gate/sessions/${movementId}/complete`, {});
      await load();
    } catch (err) {
      showError(err.response?.data?.error || t('gate.err.completeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title={t('gate.title')} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={screenStyles.contentInner} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.label}>{t('gate.label.sessionType')}</Text>
          <View style={styles.typeRow}>
            {['INBOUND', 'OUTBOUND'].map((type) => (
              <TouchableOpacity
                key={type}
                style={[styles.typeBtn, movementType === type && styles.typeBtnActive]}
                onPress={() => {
                  setMovementType(type);
                  setReferenceId('');
                }}
              >
                <Text style={[styles.typeText, movementType === type && styles.typeTextActive]}>
                  {t(`gate.type.${type}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{t('gate.label.plate')}</Text>
          <TextInput
            style={styles.input}
            value={plate}
            autoCapitalize="characters"
            onChangeText={setPlate}
            placeholder={t('gate.placeholder.plate')}
            placeholderTextColor={colors.textPlaceholder}
          />

          <Text style={styles.label}>{t('gate.label.driver')}</Text>
          <TextInput
            style={styles.input}
            value={driver}
            onChangeText={setDriver}
            placeholder={t('gate.placeholder.driver')}
            placeholderTextColor={colors.textPlaceholder}
          />

          <Text style={styles.label}>
            {movementType === 'INBOUND' ? t('gate.label.poId') : t('gate.label.soId')}
          </Text>
          <TextInput
            style={styles.input}
            value={referenceId}
            onChangeText={setReferenceId}
            keyboardType="number-pad"
            placeholder={t('gate.placeholder.refId')}
            placeholderTextColor={colors.textPlaceholder}
          />

          {msg ? <Text style={styles.ok}>{msg}</Text> : null}

          <TouchableOpacity
            style={[buttonStyles.buttonPrimary, busy && buttonStyles.buttonDisabled]}
            onPress={checkIn}
            disabled={busy}
          >
            <Text style={buttonStyles.buttonPrimaryText}>{t('gate.btn.checkIn')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>{t('gate.section.open')}</Text>
        {sessions.length === 0 ? (
          <Text style={styles.empty}>{t('gate.empty')}</Text>
        ) : (
          sessions.map((s) => (
            <View key={s.movement_id} style={listStyles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.plate}>{s.vehicle_plate}</Text>
                <Text style={styles.meta}>
                  {t(`gate.type.${s.movement_type}`)}
                  {s.reference_number ? ` · ${s.reference_type} ${s.reference_number}` : ''}
                  {` · ${s.status}`}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.doneBtn}
                onPress={() => complete(s.movement_id)}
                disabled={busy}
              >
                <Text style={styles.doneText}>{t('gate.btn.done')}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <ErrorPopup visible={!!error} message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 16,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 6,
    marginTop: 8,
  },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  typeBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.small,
    paddingVertical: 10,
    alignItems: 'center',
  },
  typeBtnActive: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  typeText: { fontFamily: fonts.mono, fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  typeTextActive: { color: colors.accent },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.textPrimary,
  },
  ok: { fontFamily: fonts.mono, fontSize: 12, color: colors.success, marginVertical: 8 },
  section: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  empty: { fontFamily: fonts.mono, fontSize: 12, color: colors.textMuted },
  plate: { fontFamily: fonts.mono, fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  meta: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, marginTop: 2 },
  doneBtn: {
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radii.small,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  doneText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: '700', color: colors.success },
});
