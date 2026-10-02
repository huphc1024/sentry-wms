import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, fonts, radii } from '../theme/styles';
import { useLocale } from '../i18n/locale';
import { parseExpiryFromOcr } from '../utils/expiryParser';

export default function ExpiryOcrModal({ visible, onClose, onExpiryDetected }) {
  const { t } = useLocale();
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!visible) {
      setProcessing(false);
      setMessage('');
      return;
    }
    if (!permission?.granted) requestPermission();
  }, [permission?.granted, requestPermission, visible]);

  const captureAndRead = async () => {
    if (!cameraRef.current || processing) return;
    setProcessing(true);
    setMessage(t('common.ocrReading'));
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
      });
      // Loaded on demand so barcode and manual entry still work in Expo Go;
      // OCR itself requires a development/production native build.
      const { recognizeText } = await import('@infinitered/react-native-mlkit-text-recognition');
      const result = await recognizeText(photo.uri);
      const expiryDate = parseExpiryFromOcr(result.text);
      if (!expiryDate) {
        setMessage(t('common.ocrNotRecognized'));
        return;
      }
      onExpiryDetected?.(expiryDate);
      onClose?.();
    } catch {
      setMessage(t('common.ocrReadFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const renderCamera = () => {
    if (!permission) return <ActivityIndicator color={colors.cream} />;
    if (!permission.granted) {
      return (
        <View style={styles.centered}>
          <Text style={styles.message}>{t('common.ocrCameraPermission')}</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>{t('common.allowCamera')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return <CameraView ref={cameraRef} style={styles.camera} facing="back" />;
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('common.ocrTitle')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.preview}>
          {renderCamera()}
          <View style={styles.frame} pointerEvents="none" />
        </View>
        <Text style={styles.hint}>{t('common.ocrHint')}</Text>
        {!!message && <Text style={styles.message}>{message}</Text>}
        <TouchableOpacity
          style={[styles.captureButton, (processing || !permission?.granted) && styles.disabled]}
          onPress={captureAndRead}
          disabled={processing || !permission?.granted}
        >
          {processing
            ? <ActivityIndicator color={colors.cream} />
            : <Text style={styles.captureButtonText}>{t('common.ocrCapture')}</Text>}
        </TouchableOpacity>
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
    justifyContent: 'space-between',
    alignItems: 'center',
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
  preview: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    justifyContent: 'center',
    borderRadius: radii.card,
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  frame: {
    position: 'absolute',
    top: '35%',
    left: '6%',
    right: '6%',
    height: '24%',
    borderWidth: 2,
    borderColor: colors.copper,
    borderRadius: radii.small,
  },
  centered: {
    alignItems: 'center',
    gap: 16,
    padding: 24,
  },
  hint: {
    marginTop: 14,
    color: '#c8c0b0',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  message: {
    marginTop: 8,
    color: colors.cream,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  primaryButton: {
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  primaryButtonText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 12,
  },
  captureButton: {
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
    marginTop: 16,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
  },
  captureButtonText: {
    color: colors.cream,
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 0.7,
  },
  disabled: { opacity: 0.5 },
});
