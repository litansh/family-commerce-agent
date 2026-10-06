/**
 * Barcode scanner. Point at a product, it becomes a line with its barcode —
 * the most precise entry there is, and the fastest way to teach memory.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { t as tr } from './lib/i18n';
import { Button, S, t } from './ui';

export function Scanner({ onScan, onClose }: { onScan: (gtin: string) => void; onClose: () => void }) {
  const s = S();
  const [perm, request] = useCameraPermissions();
  const [done, setDone] = useState(false);
  useEffect(() => { if (perm && !perm.granted && perm.canAskAgain) void request(); }, [perm, request]);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[s.screen, { backgroundColor: '#000' }]}>
        {perm?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
            onBarcodeScanned={({ data }) => { if (!done && data) { setDone(true); onScan(data); } }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Text style={[s.body, { color: '#fff', textAlign: 'center' }]}>{tr('cameraNeeded')}</Text>
            <View style={{ height: 12 }} />
            <Button title={tr('allowCamera')} onPress={() => void request()} />
          </View>
        )}
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 20, paddingTop: 54 }}>
          <Pressable onPress={onClose} hitSlop={12} style={{ alignSelf: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>✕</Text>
          </Pressable>
        </View>
        <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ color: '#fff' }}>{tr('scanHint')}</Text>
          </View>
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', top: '32%', left: '12%', right: '12%', height: 140, borderWidth: 2, borderColor: t.accentSoft, borderRadius: 18 }} />
      </View>
    </Modal>
  );
}
