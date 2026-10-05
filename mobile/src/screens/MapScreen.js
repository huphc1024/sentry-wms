import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import WarehouseFloorPlan from '../components/map/WarehouseFloorPlan';
import ScreenHeader from '../components/ScreenHeader';
import ScanInput from '../components/ScanInput';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import { colors, fonts, radii, screenStyles } from '../theme/styles';
import { useLocale } from '../i18n/locale';

export default function MapScreen({ navigation, route }) {
  const { t } = useLocale();
  const { warehouseId } = useAuth();
  const { error, showError, clearError } = useScreenError();
  const [zones, setZones] = useState([]);
  const [mapLayout, setMapLayout] = useState(null);
  const [mapRacks, setMapRacks] = useState([]);
  const [highlightRackId, setHighlightRackId] = useState(null);
  const [highlightRackKey, setHighlightRackKey] = useState(null);
  const [expiryAlerts, setExpiryAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  const selectMode = route.params?.selectMode || null;
  const itemId = route.params?.itemId;
  const sku = route.params?.sku;
  const returnScreen = route.params?.returnScreen || 'PutAway';

  const load = useCallback(async () => {
    if (!warehouseId) return;
    setLoading(true);
    try {
      const [mapResp, alertResp] = await Promise.all([
        client.get(`/api/warehouse-map?warehouse_id=${warehouseId}`),
        client.get(`/api/warehouse-map/expiry-alerts?warehouse_id=${warehouseId}&days=30`),
      ]);
      setZones(mapResp.data?.zones || []);
      setMapLayout(mapResp.data?.layout || null);
      setMapRacks(mapResp.data?.racks || []);
      setExpiryAlerts(alertResp.data?.alerts || []);
    } catch (err) {
      showError(err.response?.data?.error || t('map.loadMapFailed'));
    } finally {
      setLoading(false);
    }
  }, [warehouseId, showError, t]);

  const locatePallet = async (palletCode) => {
    if (!warehouseId) return;
    try {
      const encodedCode = encodeURIComponent(palletCode.trim());
      const resp = await client.get(`/api/warehouse-map/pallet/${encodedCode}?warehouse_id=${warehouseId}`);
      const location = resp.data?.location;
      const pallet = resp.data?.pallet;
      if (!location?.rack_key) {
        showError(t('map.palletLocationNotFound'));
        return;
      }
      navigation.navigate('RackMap', {
        rackId: location.rack_id,
        rackKey: location.rack_key,
        rackLabel: location.rack_label,
        zoneCode: location.zone_code,
        focusedBinId: location.bin_id,
        palletCode: pallet?.pallet_code || palletCode,
        palletSku: pallet?.sku,
        palletSlot: location.slot_label,
      });
      setHighlightRackId(location.rack_id || null);
      setHighlightRackKey(location.rack_key);
    } catch (err) {
      showError(err.response?.data?.error || t('map.palletNotFound'));
    }
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const title = selectMode === 'putaway'
    ? t('map.titlePutaway')
    : selectMode === 'pick'
      ? t('map.titlePick')
      : t('map.title');

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title={title} onBack={() => navigation.goBack()} />
      <ScrollView style={screenStyles.content} contentContainerStyle={screenStyles.contentInner}>
        {selectMode ? (
          <Text style={styles.hint}>
            {selectMode === 'putaway'
              ? t('map.hintPutaway')
              : t('map.hintPick')}
          </Text>
        ) : (
          <Text style={styles.hint}>{t('map.hintBrowse')}</Text>
        )}
        {!selectMode && mapLayout?.has_saved_layout && (
          <WarehouseFloorPlan
            layout={mapLayout}
            zones={zones}
            racks={mapRacks}
            highlightRackId={highlightRackId}
            highlightRackKey={highlightRackKey}
          />
        )}
        {!selectMode && (
          <View style={styles.palletLookup}>
            <Text style={styles.palletLookupTitle}>{t('map.scanTitle')}</Text>
            <Text style={styles.palletLookupHint}>{t('map.scanHint')}</Text>
            <ScanInput
              placeholder={t('map.scanPlaceholder')}
              onScan={locatePallet}
            />
          </View>
        )}
        {!selectMode && expiryAlerts.length > 0 && (
          <View style={styles.expiryPanel}>
            <Text style={styles.expiryTitle}>{t('map.expiryAlerts', { count: expiryAlerts.length })}</Text>
            {expiryAlerts.slice(0, 5).map((alert) => (
              <TouchableOpacity
                key={alert.pallet_id}
                style={styles.expiryRow}
                onPress={() => navigation.navigate('RackMap', {
                  rackId: alert.location.rack_id,
                  rackKey: alert.location.rack_key,
                  rackLabel: alert.location.rack_label,
                  zoneCode: alert.location.zone_code,
                  focusedBinId: alert.location.bin_id,
                  palletCode: alert.pallet_code,
                  palletSku: alert.sku,
                  palletSlot: alert.location.slot_label,
                })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.expiryPallet}>{alert.pallet_code} · {alert.sku}</Text>
                  <Text style={styles.expiryLocation}>
                    {alert.location.rack_label} · {alert.location.slot_label} · {alert.location.bin_code}
                  </Text>
                </View>
                <Text style={[
                  styles.expiryDays,
                  alert.days_remaining < 0 && styles.expiryDaysCritical,
                ]}>
                  {alert.days_remaining < 0
                    ? t('map.daysOver', { days: Math.abs(alert.days_remaining) })
                    : t('map.daysLeft', { days: alert.days_remaining })}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 32 }} />
        ) : (
          zones.map((zone) => (
            <TouchableOpacity
              key={zone.zone_id}
              style={[styles.zoneCard, { borderLeftColor: zone.color || colors.copper }]}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('ZoneMap', {
                zoneId: zone.zone_id,
                zoneCode: zone.zone_code,
                zoneName: zone.zone_name,
                selectMode,
                itemId,
                sku,
                returnScreen,
              })}
            >
              <View style={styles.zoneTop}>
                <Text style={styles.zoneCode}>{zone.zone_code}</Text>
                <Text style={styles.zoneFill}>{zone.fill_pct ?? 0}%</Text>
              </View>
              <Text style={styles.zoneName}>{zone.zone_name}</Text>
              <Text style={styles.zoneMeta}>
                {t('map.zoneMeta', { racks: zone.rack_count ?? 0, occupied: zone.occupied_bins, total: zone.bin_count })}
              </Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { width: `${zone.fill_pct ?? 0}%`, backgroundColor: zone.color || colors.copper }]} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
      <ErrorPopup visible={!!error} message={error} onDismiss={clearError} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 12,
    lineHeight: 16,
  },
  palletLookup: {
    backgroundColor: colors.cardBg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 12,
  },
  palletLookupTitle: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
    letterSpacing: 0.4,
  },
  palletLookupHint: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
    lineHeight: 15,
    marginTop: 4,
    marginBottom: 10,
  },
  expiryPanel: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 12,
  },
  expiryTitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.warning,
    marginBottom: 8,
  },
  expiryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: colors.warning,
    paddingVertical: 8,
  },
  expiryPallet: { fontFamily: fonts.mono, fontSize: 10, fontWeight: '700', color: colors.textPrimary },
  expiryLocation: { fontFamily: fonts.mono, fontSize: 9, color: colors.textMuted, marginTop: 2 },
  expiryDays: { fontFamily: fonts.mono, fontSize: 9, fontWeight: '700', color: colors.warning },
  expiryDaysCritical: { color: colors.danger },
  zoneCard: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderLeftWidth: 5,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 10,
  },
  zoneTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoneCode: {
    fontFamily: fonts.mono,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  zoneFill: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
  },
  zoneName: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
  zoneMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 6,
  },
  barTrack: {
    height: 4,
    backgroundColor: colors.cardBorder,
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
});
