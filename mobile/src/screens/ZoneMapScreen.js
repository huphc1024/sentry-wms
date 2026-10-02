import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../auth/AuthContext';
import client from '../api/client';
import ScreenHeader from '../components/ScreenHeader';
import ErrorPopup from '../components/ErrorPopup';
import useScreenError from '../hooks/useScreenError';
import { colors, fonts, radii, screenStyles } from '../theme/styles';
import { useLocale } from '../i18n/locale';

export default function ZoneMapScreen({ navigation, route }) {
  const { t } = useLocale();
  const { warehouseId } = useAuth();
  const { zoneId, zoneCode, zoneName, selectMode, itemId, sku, returnScreen } = route.params || {};
  const { error, showError, clearError } = useScreenError();
  const [racks, setRacks] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!warehouseId || !zoneId) return;
    setLoading(true);
    try {
      const resp = await client.get(`/api/warehouse-map?warehouse_id=${warehouseId}&zone_id=${zoneId}`);
      setRacks(resp.data?.racks || []);
    } catch (err) {
      showError(err.response?.data?.error || t('map.loadRackFailed'));
    } finally {
      setLoading(false);
    }
  }, [warehouseId, zoneId, showError, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={screenStyles.screen}>
      <ScreenHeader title={zoneCode || t('map.zoneTitle')} onBack={() => navigation.goBack()} />
      <ScrollView style={screenStyles.content} contentContainerStyle={screenStyles.contentInner}>
        <Text style={styles.subtitle}>{zoneName}</Text>
        <Text style={styles.hint}>{t('map.zoneHint')}</Text>

        {loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 32 }} />
        ) : (
          racks.map((rack) => (
            <TouchableOpacity
              key={rack.rack_key}
              style={styles.rackCard}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('RackMap', {
                rackId: rack.rack_id,
                rackKey: rack.rack_key,
                rackLabel: rack.rack_label,
                zoneCode,
                selectMode,
                itemId,
                sku,
                returnScreen,
              })}
            >
              <View style={styles.rackTop}>
                <Text style={styles.rackLabel}>{t('map.bay', { label: rack.rack_label })}</Text>
                <Text style={styles.rackFill}>{rack.fill_pct}%</Text>
              </View>
              <Text style={styles.rackMeta}>
                {t('map.aisleMeta', { aisle: rack.aisle || '—', occupied: rack.occupied_slots, total: rack.total_slots })}
              </Text>
              <View style={styles.miniGrid}>
                {[1, 2, 3, 4].map((lvl) => (
                  <View
                    key={lvl}
                    style={[
                      styles.miniLevel,
                      { opacity: 0.35 + (lvl / 4) * 0.55 },
                    ]}
                  />
                ))}
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
  subtitle: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  hint: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 12,
  },
  rackCard: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 10,
  },
  rackTop: { flexDirection: 'row', justifyContent: 'space-between' },
  rackLabel: {
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  rackFill: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '700',
    color: colors.copper,
  },
  rackMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: 10,
  },
  miniGrid: { flexDirection: 'row', gap: 6 },
  miniLevel: {
    flex: 1,
    height: 8,
    backgroundColor: colors.copper,
    borderRadius: 2,
  },
});
