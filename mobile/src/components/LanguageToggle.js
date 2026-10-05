import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocale } from '../i18n/locale.js';
import { colors } from '../theme/styles';

const OPTIONS = [
  { code: 'vi', labelKey: 'lang.vi' },
  { code: 'en', labelKey: 'lang.en' },
];

/** Two-button VI / EN switch. The choice is stored on the device. */
export default function LanguageToggle({ style }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <View style={[styles.row, style]} accessibilityRole="radiogroup">
      {OPTIONS.map((o) => {
        const active = locale === o.code;
        return (
          <Pressable
            key={o.code}
            onPress={() => setLocale(o.code)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.btn, active && styles.btnActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{t(o.labelKey)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  btn: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  btnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  labelActive: { color: colors.onAccent },
});
