import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocale } from '../i18n/locale.js';
import { colors, fonts, radii, screenStyles, buttonStyles, doneStyles } from '../theme/styles';

export default function PickCompleteScreen({ navigation, route }) {
  const { t } = useLocale();
  const { total_picks = 0, total_orders = 0, shorts = 0 } = route.params || {};

  return (
    <View style={screenStyles.screen}>
      <View style={doneStyles.section}>
        <Text style={doneStyles.check}>&#10003;</Text>
        <Text style={doneStyles.title}>{t('pick.batchComplete')}</Text>
        <Text style={doneStyles.detail}>
          {t('pick.readyForPacking', { orders: t(total_orders !== 1 ? 'pick.orders_other' : 'pick.orders_one', { count: total_orders }) })}
        </Text>

        <View style={styles.summary}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{t('pick.totalPicks')}</Text>
            <Text style={styles.summaryValue}>{total_picks}</Text>
          </View>
          {shorts > 0 && (
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('pick.shortPicks')}</Text>
              <Text style={[styles.summaryValue, styles.shortValue]}>{shorts}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[buttonStyles.buttonPrimary, { width: '100%', marginBottom: 12, paddingHorizontal: 32 }]}
          onPress={() => navigation.replace('PickScan')}
        >
          <Text style={buttonStyles.buttonPrimaryText}>{t('pick.startNewBatch')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[buttonStyles.buttonSecondary, { width: '100%', paddingHorizontal: 32 }]}
          onPress={() => navigation.navigate('Home')}
        >
          <Text style={buttonStyles.buttonSecondaryText}>{t('pick.done')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  summary: {
    width: '100%',
    marginBottom: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  summaryLabel: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.textMuted,
  },
  summaryValue: {
    fontFamily: fonts.mono,
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  shortValue: {
    color: colors.copper,
  },
});
