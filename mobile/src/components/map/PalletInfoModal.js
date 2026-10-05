import React, { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { colors, fonts, radii, buttonStyles } from '../../theme/styles';
import { getExpiryStatus } from '../../utils/expiryStatus';
import { useLocale } from '../../i18n/locale';

export default function PalletInfoModal({
  visible,
  bin,
  pallet,
  onClose,
  onSelect,
  selectLabel,
}) {
  const { t } = useLocale();
  const [selectedLine, setSelectedLine] = useState(null);

  const pallets = pallet ? [pallet] : (bin?.pallets || []);
  const contents = bin?.contents || [];

  useEffect(() => {
    if (!visible) {
      setSelectedLine(null);
      return;
    }
    if (pallet) {
      pickLine({
        key: pallet.pallet_id,
        item_id: pallet.item_id,
        sku: pallet.sku,
        item_name: pallet.item_name,
        quantity_on_hand: pallet.quantity_on_hand,
        lot_code: pallet.lot_code,
        expiry_date: pallet.expiry_date,
      });
    }
  }, [visible, pallet]);

  if (!bin) return null;

  const pickLine = (line) => {
    setSelectedLine(line);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{bin.bin_code}</Text>
          <Text style={styles.sub}>
            {bin.zone_name} · {bin.rack_label || ''} · {bin.slot_label || ''}
          </Text>
          <Text style={styles.meta}>{t('map.binMeta', { type: bin.bin_type || 'Storage', qty: bin.total_qty || 0 })}</Text>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollInner}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
          >
            <Text style={styles.sectionTitle}>{t('map.contents')}</Text>
            {pallets.length > 0 ? (
              pallets.map((p) => {
                const active = selectedLine?.key === p.pallet_id;
                const expiryStatus = getExpiryStatus(p.expiry_date);
                return (
                  <TouchableOpacity
                    key={p.pallet_id}
                    style={[styles.palletCard, active && styles.palletCardActive]}
                    onPress={() => pickLine({
                      key: p.pallet_id,
                      item_id: p.item_id,
                      sku: p.sku,
                      item_name: p.item_name,
                      quantity_on_hand: p.quantity_on_hand,
                      lot_code: p.lot_code,
                      expiry_date: p.expiry_date,
                    })}
                  >
                    <Text style={styles.palletId}>{p.pallet_code || p.pallet_id}</Text>
                    <Text style={styles.palletSku}>{p.sku}</Text>
                    <Text style={styles.palletName}>{p.item_name}</Text>
                    <Text style={styles.palletQty}>{t('map.qty', { qty: p.quantity_on_hand })}</Text>
                    {p.lot_code ? <Text style={styles.palletLot}>{t('map.lot', { lot: p.lot_code })}</Text> : null}
                    {p.expiry_date ? <Text style={styles.palletLot}>{t('map.expiry', { date: p.expiry_date })}</Text> : null}
                    {expiryStatus && expiryStatus.level !== 'ok' ? (
                      <View style={[
                        styles.expiryBadge,
                        expiryStatus.level === 'expired' ? styles.expiryBadgeDanger : styles.expiryBadgeWarning,
                      ]}>
                        <Text style={[
                          styles.expiryBadgeText,
                          expiryStatus.level === 'expired' ? styles.expiryBadgeDangerText : styles.expiryBadgeWarningText,
                        ]}>
                          {expiryStatus.label}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            ) : contents.length > 0 ? (
              contents.map((c, i) => {
                const key = `${c.item_id}-${i}`;
                const active = selectedLine?.key === key;
                const expiryStatus = getExpiryStatus(c.expiry_date);
                return (
                  <TouchableOpacity
                    key={key}
                    style={[styles.palletCard, active && styles.palletCardActive]}
                    onPress={() => pickLine({
                      key,
                      item_id: c.item_id,
                      sku: c.sku,
                      item_name: c.item_name,
                      quantity_on_hand: c.quantity_on_hand,
                      lot_code: c.lot_number,
                      expiry_date: c.expiry_date,
                    })}
                  >
                    <Text style={styles.palletSku}>{c.sku}</Text>
                    <Text style={styles.palletName}>{c.item_name}</Text>
                    <Text style={styles.palletQty}>{t('map.qty', { qty: c.quantity_on_hand })}</Text>
                    {c.lot_number ? <Text style={styles.palletLot}>{t('map.lot', { lot: c.lot_number })}</Text> : null}
                    {expiryStatus && expiryStatus.level !== 'ok' ? (
                      <Text style={[
                        styles.expiryInline,
                        expiryStatus.level === 'expired' ? styles.expiryDangerText : styles.expiryWarningText,
                      ]}>
                        {t('map.expiry', { date: c.expiry_date })} · {expiryStatus.label}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.empty}>{t('map.emptySlot')}</Text>
            )}

            {!onSelect ? (
              <View style={styles.moveBox}>
                <Text style={styles.readOnlyHint}>
                  {t('map.readOnlyHint')}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            {onSelect ? (
              <TouchableOpacity style={[buttonStyles.buttonPrimary, styles.btn]} onPress={onSelect}>
                <Text style={buttonStyles.buttonPrimaryText}>{selectLabel || t('map.selectLocation')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[buttonStyles.buttonSecondary, styles.btn, onSelect ? null : styles.closeBtn]}
              onPress={onClose}
            >
              <Text style={buttonStyles.buttonSecondaryText}>{t('map.close')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: colors.background,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 16,
    maxHeight: '90%',
  },
  title: {
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  meta: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: 10,
  },
  scroll: {
    flexGrow: 0,
    maxHeight: 420,
  },
  scrollInner: {
    paddingBottom: 8,
  },
  sectionTitle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 8,
    letterSpacing: 0.4,
  },
  palletCard: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 10,
    marginBottom: 8,
  },
  palletCardActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  palletId: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
    marginBottom: 2,
  },
  palletSku: {
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: '700',
    color: colors.accent,
  },
  palletName: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textPrimary,
    marginTop: 2,
  },
  palletQty: {
    fontFamily: fonts.mono,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 4,
  },
  palletLot: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
  },
  expiryBadge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginTop: 7,
  },
  expiryBadgeDanger: {
    backgroundColor: colors.accentBg,
    borderColor: colors.danger,
  },
  expiryBadgeWarning: {
    backgroundColor: colors.warningBg,
    borderColor: colors.copper,
  },
  expiryBadgeText: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: '700',
  },
  expiryBadgeDangerText: { color: colors.danger },
  expiryBadgeWarningText: { color: colors.accent },
  expiryInline: {
    fontFamily: fonts.mono,
    fontSize: 9,
    fontWeight: '700',
    marginTop: 5,
  },
  expiryDangerText: { color: colors.danger },
  expiryWarningText: { color: colors.warning },
  empty: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 16,
  },
  moveBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  readOnlyHint: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },
  selectedSku: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  selectedSkuBold: {
    color: colors.textPrimary,
    fontWeight: '700',
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  qtyLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textSecondary,
  },
  qtyInput: {
    flex: 1,
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
  err: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.danger,
    marginBottom: 6,
  },
  ok: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.success,
    marginBottom: 6,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  btn: {
    flexGrow: 1,
    minWidth: '30%',
    marginTop: 0,
  },
  closeBtn: {
    minWidth: '100%',
  },
});
