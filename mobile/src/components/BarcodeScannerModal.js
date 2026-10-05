import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, fonts, radii } from '../theme/styles';
import { useLocale } from '../i18n/locale';

const BARCODE_TYPES = [
  'qr',
  'code128',
  'code39',
  'code93',
  'ean13',
  'ean8',
  'upc_a',
  'upc_e',
  'codabar',
  'itf14',
  'datamatrix',
  'pdf417',
];

export default function BarcodeScannerModal({ visible, onClose, onScan }) {
  const { t } = useLocale();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [status, setStatus] = useState('');
  const lastScanRef = useRef({ value: '', at: 0 });
  const processingRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      setStatus('');
      processingRef.current = false;
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || permission?.granted) return;
    requestPermission();
  }, [visible, permission?.granted, requestPermission]);

  const handleBarcodeScanned = useCallback(async ({ data }) => {
    if (!data || processingRef.current) return;
    const trimmed = String(data).replace(/[\r\n\s]+/g, '').trim();
    if (!trimmed) return;

    const now = Date.now();
    if (lastScanRef.current.value === trimmed && now - lastScanRef.current.at < 1500) {
      return;
    }
    lastScanRef.current = { value: trimmed, at: now };
    processingRef.current = true;
    setStatus(trimmed);

    try {
      await Promise.resolve(onScan?.(trimmed));
      onClose?.();
    } catch (error) {
      setStatus(error?.message || t('common.scanFailed'));
      processingRef.current = false;
    }
  }, [onClose, onScan, t]);

  const renderBody = () => {
    if (!permission) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cream} />
        </View>
      );
    }

    if (!permission.granted) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('common.cameraPermissionScan')}</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>{t('common.allowCamera')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
            <Text style={styles.secondaryBtnText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <CameraView
        style={styles.camera}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={handleBarcodeScanned}
      />
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('common.scanTitle')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.previewWrap}>
          {renderBody()}
          <View style={styles.frame} pointerEvents="none" />
        </View>

        <Text style={styles.hint}>{t('common.scanHint')}</Text>
        {!!status && <Text style={styles.status}>{status}</Text>}

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => setTorch((v) => !v)}
            disabled={!permission?.granted}
          >
            <Text style={styles.actionBtnText}>{torch ? t('common.torchOff') : t('common.torchOn')}</Text>
          </TouchableOpacity>
          <Pressable style={styles.actionBtn} onPress={onClose}>
            <Text style={styles.actionBtnText}>{t('common.typeInstead')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111',
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 16,
    letterSpacing: 1,
  },
  close: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  previewWrap: {
    flex: 1,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },
  frame: {
    position: 'absolute',
    top: '22%',
    left: '8%',
    right: '8%',
    height: '42%',
    borderWidth: 2,
    borderColor: colors.copper,
    borderRadius: radii.small,
  },
  hint: {
    marginTop: 14,
    color: '#c8c0b0',
    fontSize: 12,
    textAlign: 'center',
  },
  status: {
    marginTop: 8,
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 12,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: '#2a2620',
    borderRadius: radii.button,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionBtnText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  message: {
    color: colors.cream,
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.button,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: {
    color: '#c8c0b0',
    fontFamily: fonts.mono,
    fontSize: 11,
  },
});
