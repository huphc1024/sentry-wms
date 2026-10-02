import React, { useRef, useState, useEffect } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { colors, fonts, radii } from '../theme/styles';
import { useScanSettingsContext } from '../context/ScanSettingsContext';
import BarcodeScannerModal from './BarcodeScannerModal';
import { useLocale } from '../i18n/locale';

export default function ScanInput({
  placeholder,
  onScan,
  disabled = false,
  autoFocus = true,
  suppressRefocus = false,
  enableCameraScan = true,
}) {
  const { t } = useLocale();
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  const bufferRef = useRef('');
  const [processing, setProcessing] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  // True only while the user is manually typing. Keeps the soft keyboard
  // hidden during auto-focus and the 1-second refocus loop (hardware scan
  // flow), while still letting a tap open the keyboard for manual fallback.
  const [softInput, setSoftInput] = useState(false);
  const scanSettings = useScanSettingsContext();

  // Register this ScanInput's onScan as the active intent handler
  // when the component is mounted and not disabled
  useEffect(() => {
    if (!scanSettings || scanSettings.mode !== 'intent' || disabled) return;
    const handler = (barcode) => {
      if (disabled || processing) return;
      const trimmed = barcode.replace(/[\r\n\s]+/g, '').trim();
      if (!trimmed || !onScan) return;
      setProcessing(true);
      Promise.resolve(onScan(trimmed)).finally(() => {
        setProcessing(false);
      });
    };
    scanSettings.registerScanHandler(handler);
    return () => scanSettings.unregisterScanHandler(handler);
  }, [scanSettings?.mode, onScan, disabled, processing]);

  useEffect(() => {
    if (autoFocus && !disabled && !processing && !suppressRefocus) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, disabled, processing, suppressRefocus]);

  // Re-focus input when it loses focus (hardware scanner can steal focus)
  // Suppressed when another input (e.g. qty field) has focus
  useEffect(() => {
    if (disabled || processing || suppressRefocus) return;
    const interval = setInterval(() => {
      try {
        if (inputRef.current && typeof inputRef.current.isFocused === 'function' && !inputRef.current.isFocused()) {
          inputRef.current.focus();
        }
      } catch {
        // Swallow focus errors on hardware scanner devices
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [disabled, processing, suppressRefocus]);

  const scanInFlightRef = useRef(false);

  const handleSubmit = () => {
    const raw = bufferRef.current;
    setValue('');
    bufferRef.current = '';
    setSoftInput(false);
    if (!raw.replace(/[\r\n\s]+/g, '').trim()) {
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    submitBarcode(raw);
  };

  const handlePressIn = () => {
    if (softInput) return;
    setSoftInput(true);
    // Force a focus cycle so the updated showSoftInputOnFocus prop applies
    // and the keyboard actually opens on this tap.
    setTimeout(() => {
      inputRef.current?.blur();
      setTimeout(() => inputRef.current?.focus(), 0);
    }, 0);
  };

  const handleBlur = () => {
    setSoftInput(false);
  };

  const handleChangeText = (text) => {
    // Strip control characters that hardware scanners may inject (keep printable chars only)
    const cleaned = text.replace(/[\r\n\t]/g, '');
    bufferRef.current = cleaned;
    setValue(cleaned);
    // NO auto-submit timer. Only process on Enter/Submit (onSubmitEditing).
    // C6000 scanners send characters one at a time; a timer causes partial submits.
  };

  const submitBarcode = (raw) => {
    const trimmed = raw.replace(/[\r\n\s]+/g, '').trim();
    if (!trimmed || !onScan || scanInFlightRef.current) {
      return Promise.resolve();
    }

    scanInFlightRef.current = true;
    setProcessing(true);
    return Promise.resolve(onScan(trimmed)).finally(() => {
      scanInFlightRef.current = false;
      setProcessing(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    });
  };

  const handleCameraScan = async (barcode) => {
    setValue('');
    bufferRef.current = '';
    await submitBarcode(barcode);
  };

  const IGNORED_KEYS = ['Escape', 'GoBack', 'F1', 'F2', 'F3', 'F4', 'F5',
    'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Tab'];

  return (
    <>
      <View style={[styles.container, (disabled || processing) && styles.disabled]}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          placeholder={processing ? t('common.processing') : (placeholder ?? t('common.scanBarcode'))}
          placeholderTextColor={colors.textPlaceholder}
          value={value}
          onChangeText={handleChangeText}
          onSubmitEditing={handleSubmit}
          onKeyPress={(e) => {
            if (IGNORED_KEYS.includes(e.nativeEvent.key)) {
              e.preventDefault?.();
              e.stopPropagation?.();
            }
          }}
          onPressIn={handlePressIn}
          onBlur={handleBlur}
          editable={!disabled && !processing}
          autoFocus={autoFocus && !disabled}
          autoCapitalize="characters"
          autoCorrect={false}
          blurOnSubmit={false}
          returnKeyType="done"
          showSoftInputOnFocus={softInput}
          selectTextOnFocus
        />
        {enableCameraScan && (
          <TouchableOpacity
            style={[styles.cameraBtn, (disabled || processing) && styles.cameraBtnDisabled]}
            onPress={() => setShowCamera(true)}
            disabled={disabled || processing}
            accessibilityLabel={t('common.openCameraScanner')}
          >
            <Text style={styles.cameraBtnText}>CAM</Text>
          </TouchableOpacity>
        )}
      </View>
      <BarcodeScannerModal
        visible={showCamera}
        onClose={() => setShowCamera(false)}
        onScan={handleCameraScan}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    borderRadius: radii.input,
    paddingHorizontal: 12,
    minHeight: 44,
    marginBottom: 16,
  },
  disabled: {
    backgroundColor: colors.cardBg,
    borderColor: colors.cardBorder,
  },
  input: {
    flex: 1,
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 1,
    paddingVertical: 10,
  },
  cameraBtn: {
    marginLeft: 8,
    backgroundColor: colors.accent,
    borderRadius: radii.small,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBtnDisabled: {
    opacity: 0.45,
  },
  cameraBtnText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    fontWeight: '700',
  },
});
