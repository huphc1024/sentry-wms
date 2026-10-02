import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import ScreenHeader from '../components/ScreenHeader';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import PalletSlotGrid from '../components/map/PalletSlotGrid';
import PalletInfoModal from '../components/map/PalletInfoModal';
import { colors, fonts, screenStyles } from '../theme/styles';
import { useLocale } from '../i18n/locale';

export default function RackMapScreen({ navigation, route }) {
  const { t } = useLocale();
  const { warehouseId } = useAuth();
  const {
    rackId,
    rackKey,
    rackLabel,
    zoneCode,
    selectMode,
    itemId,
    sku,
    returnScreen,
    focusedBinId,
    palletCode,
    palletSku,
    palletSlot,
  } = route.params || {};

  const { error, showError, clearError } = useScreenError();
  const [rack, setRack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!warehouseId || (!rackId && !rackKey)) return null;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ warehouse_id: String(warehouseId) });
      if (selectMode) params.set('mode', selectMode);
      if (itemId) params.set('item_id', String(itemId));
      if (sku) params.set('sku', sku);
      const rackPath = rackId
        ? `by-id/${rackId}` // i18n-ignore
        : encodeURIComponent(rackKey);
      const resp = await client.get(`/api/warehouse-map/rack/${rackPath}?${params.toString()}`);
      const nextRack = resp.data?.rack || null;
      setRack(nextRack);
      return nextRack;
    } catch (err) {
      showError(err.response?.data?.error || t('map.loadRackFailed'));
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [warehouseId, rackId, rackKey, selectMode, itemId, sku, showError, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSlotPress = (slot) => {
    if (!slot?.bin) return;
    setSelectedSlot(slot);
    setModalVisible(true);
  };

  const refreshAfterMove = async () => {
    const binId = selectedSlot?.bin?.bin_id;
    const nextRack = await load({ silent: true });
    if (!binId || !nextRack?.levels) return;
    for (const level of nextRack.levels) {
      for (const slot of level.positions || []) {
        if (slot?.bin?.bin_id === binId) {
          setSelectedSlot(slot);
          return;
        }
      }
    }
  };

  const confirmSelection = () => {
    const bin = selectedSlot?.bin;
    if (!bin) return;
    setModalVisible(false);

    if (selectMode && returnScreen) {
      navigation.navigate({
        name: returnScreen,
        params: {
          mapSelectedBin: {
            bin_id: bin.bin_id,
            bin_code: bin.bin_code,
            zone_name: bin.zone_name,
          },
        },
        merge: true,
      });
      navigation.pop(3);
      return;
    }

    setSelectedSlot(null);
  };

  const selectLabel = selectMode === 'putaway'
    ? t('map.putHere')
    : selectMode === 'pick'
      ? t('map.pickHere')
      : null;

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader
        title={rackLabel || t('map.rackTitle')}
        onBack={() => navigation.goBack()}
      />
      <ScrollView style={screenStyles.content} contentContainerStyle={screenStyles.contentInner}>
        <Text style={styles.meta}>
          {zoneCode} · {t('map.rackMeta', { occupied: rack?.occupied_slots ?? 0, total: rack?.total_slots ?? 0 })}
        </Text>
        {selectMode ? (
          <Text style={styles.hint}>
            {selectMode === 'putaway'
              ? t('map.rackHintPutaway')
              : t('map.rackHintPick')}
          </Text>
        ) : (
          <Text style={styles.hint}>
            {palletCode
              ? t('map.palletAt', {
                code: `${palletCode}${palletSku ? ` · ${palletSku}` : ''}`,
                slot: palletSlot || t('map.selectedLocation'),
              })
              : t('map.rackHintBrowse')}
          </Text>
        )}

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 32 }} />
        ) : (
          <PalletSlotGrid
            levels={rack?.levels || []}
            selectMode={selectMode}
            focusedBinId={focusedBinId}
            onSlotPress={handleSlotPress}
          />
        )}
      </ScrollView>

      <PalletInfoModal
        visible={modalVisible}
        bin={selectedSlot?.bin}
        warehouseId={warehouseId}
        onClose={() => {
          setModalVisible(false);
          setSelectedSlot(null);
        }}
        onSelect={
          selectMode && selectedSlot?.selectable
            ? confirmSelection
            : null
        }
        selectLabel={selectLabel}
        onInventoryChanged={refreshAfterMove}
      />

      <ErrorPopup visible={!!error} message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  meta: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  hint: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 14,
    lineHeight: 16,
  },
});
