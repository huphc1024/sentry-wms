import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocale } from '../../i18n/locale';
import { colors, fonts, radii } from '../../theme/styles';
import { getMostUrgentExpiry } from '../../utils/expiryStatus';

const SLOT_COLORS = {
  empty: { fill: colors.cardBg, border: colors.grayAccent, text: colors.textMuted },
  partial: { fill: colors.successBg, border: colors.success, text: colors.success },
  full: { fill: colors.successBg, border: colors.success, text: colors.success },
  highlight: { fill: colors.warningBg, border: colors.copper, text: colors.copper },
  disabled: { fill: colors.cardBg, border: colors.textPlaceholder, text: colors.textPlaceholder },
};

function slotStyle(slot, selectMode) {
  if (selectMode && !slot.selectable) {
    return SLOT_COLORS.disabled;
  }
  if (slot.highlight) {
    return SLOT_COLORS.highlight;
  }
  if (slot.is_empty || slot.status === 'empty') {
    return SLOT_COLORS.empty;
  }
  if (slot.status === 'full') {
    return SLOT_COLORS.full;
  }
  return SLOT_COLORS.partial;
}

export default function PalletSlotGrid({ levels = [], onSlotPress, selectMode = null, focusedBinId = null }) {
  const { t } = useLocale();
  return (
    <View style={styles.wrap}>
      {levels.map((levelRow) => (
        <View key={`L${levelRow.level}`} style={styles.levelRow}>
          <View style={styles.levelLabel}>
            <Text style={styles.levelLabelText}>L{levelRow.level}</Text>
          </View>
          <View style={styles.positionsRow}>
            {(levelRow.positions || []).map((slot) => {
              const bin = slot.bin;
              const palette = slotStyle(slot, selectMode);
              const isFocused = bin?.bin_id === focusedBinId;
              const qty = bin?.total_qty || 0;
              const sku = bin?.contents?.[0]?.sku || bin?.pallets?.[0]?.sku;
              const expiryStatus = getMostUrgentExpiry([
                ...(bin?.pallets || []),
                ...(bin?.contents || []),
              ]);
              return (
                <TouchableOpacity
                  key={`L${levelRow.level}-P${slot.position}`}
                  style={[
                    styles.slot,
                    { backgroundColor: palette.fill, borderColor: palette.border },
                    (slot.highlight || isFocused) && styles.slotHighlight,
                    isFocused && styles.slotFocused,
                  ]}
                  activeOpacity={0.75}
                  disabled={selectMode && !slot.selectable}
                  onPress={() => onSlotPress?.(slot, levelRow.level)}
                >
                  {expiryStatus && expiryStatus.level !== 'ok' ? (
                    <View style={[
                      styles.expiryDot,
                      expiryStatus.level === 'expired' ? styles.expiryDotDanger : styles.expiryDotWarning,
                    ]}>
                      <Text style={styles.expiryDotText}>{t('map.expiryShort')}</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.slotCode, { color: palette.text }]}>
                    P{slot.position}
                  </Text>
                  {bin ? (
                    <>
                      <Text style={styles.slotBin} numberOfLines={1}>{bin.bin_code}</Text>
                      {qty > 0 ? (
                        <Text style={styles.slotQty}>{t('map.qtyUnits', { qty })}</Text>
                      ) : (
                        <Text style={styles.slotEmpty}>{t('map.empty')}</Text>
                      )}
                      {sku ? (
                        <Text style={styles.slotSku} numberOfLines={1}>{sku}</Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.slotEmpty}>—</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  levelRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  levelLabel: {
    width: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.cardBg,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  levelLabelText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  positionsRow: { flex: 1, flexDirection: 'row', gap: 8 },
  slot: {
    flex: 1,
    minHeight: 88,
    borderWidth: 1.5,
    borderRadius: radii.card,
    padding: 8,
    justifyContent: 'center',
    position: 'relative',
  },
  slotHighlight: { borderWidth: 2 },
  slotFocused: { borderColor: colors.accent, borderWidth: 3 },
  slotCode: {
    fontFamily: fonts.mono,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
  },
  slotBin: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  slotQty: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  slotSku: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.copper,
    marginTop: 2,
  },
  slotEmpty: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
  },
  expiryDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    minWidth: 25,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    alignItems: 'center',
  },
  expiryDotDanger: { backgroundColor: colors.danger },
  expiryDotWarning: { backgroundColor: colors.warning },
  expiryDotText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 7,
    fontWeight: '700',
  },
});
