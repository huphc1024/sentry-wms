import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, fonts, mapColors, radii } from '../../theme/styles';
import { useLocale } from '../../i18n/locale';

const PREVIEW_SCALE = 5.5;

function m(value) {
  return value * PREVIEW_SCALE;
}

function PathSegment({ p1, p2, color, widthM }) {
  const dx = m(p2.x - p1.x);
  const dy = m(p2.y - p1.y);
  const length = Math.sqrt(dx * dx + dy * dy) || 1;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <View
      style={{
        position: 'absolute',
        left: m(p1.x),
        top: m(p1.y),
        width: length,
        height: Math.max(2, widthM * PREVIEW_SCALE * 0.35),
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
        transformOrigin: 'left center',
        opacity: 0.85,
      }}
    />
  );
}

export default function WarehouseFloorPlan({
  layout,
  zones = [],
  racks = [],
  highlightRackId = null,
  highlightRackKey = null,
}) {
  const { t } = useLocale();
  const config = layout?.config || {
    world_width_m: 50,
    world_height_m: 40,
    warehouse_x_m: 2,
    warehouse_y_m: 2,
    warehouse_w_m: 46,
    warehouse_h_m: 30,
    coordinate_unit: 'LEGACY_CANVAS',
  };

  const paths = layout?.paths || [];
  const rackLayouts = useMemo(() => {
    const byId = new Map(
      (layout?.racks || []).filter((r) => r.rack_id).map((r) => [r.rack_id, r]),
    );
    const byKey = new Map((layout?.racks || []).map((r) => [r.rack_key, r]));
    return racks.map((rack) => ({
      ...rack,
      geom: byId.get(rack.rack_id) || byKey.get(rack.rack_key) || rack.layout || null,
    })).filter((rack) => rack.geom);
  }, [layout, racks]);

  const meterZones = useMemo(() => (
    zones.filter((zone) => {
      const bounds = zone.bounds;
      if (!bounds) return false;
      return bounds.coordinate_unit !== 'LEGACY_CANVAS';
    })
  ), [zones]);

  if (config.coordinate_unit !== 'METER') return null;

  const canvasW = m(config.world_width_m);
  const canvasH = m(config.world_height_m);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{t('map.floorPlan')}</Text>
      <View style={[styles.canvas, { width: canvasW, height: canvasH }]}>
        <View
          style={[
            styles.warehouse,
            {
              left: m(config.warehouse_x_m),
              top: m(config.warehouse_y_m),
              width: m(config.warehouse_w_m),
              height: m(config.warehouse_h_m),
            },
          ]}
        />
        {meterZones.map((zone) => {
          const bounds = zone.bounds;
          if (!bounds) return null;
          return (
            <View
              key={zone.zone_id}
              style={[
                styles.zone,
                {
                  left: m(bounds.x),
                  top: m(bounds.y),
                  width: m(bounds.w),
                  height: m(bounds.h),
                  borderLeftColor: zone.color || colors.copper,
                },
              ]}
            />
          );
        })}
        {paths.map((path) => (
          <React.Fragment key={path.path_id || path.client_id || path.label}>
            {path.points?.slice(0, -1).map((pt, index) => (
              <PathSegment
                key={`${path.path_id || path.label}-${index}`}
                p1={pt}
                p2={path.points[index + 1]}
                color={path.path_type === 'FORKLIFT' ? mapColors.route : mapColors.walkway}
                widthM={path.width_m || 2}
              />
            ))}
          </React.Fragment>
        ))}
        {rackLayouts.map((rack) => {
          const g = rack.geom;
          const highlighted = highlightRackId
            ? highlightRackId === rack.rack_id
            : highlightRackKey === rack.rack_key;
          return (
            <View
              key={rack.rack_id || rack.rack_key}
              style={[
                styles.rack,
                {
                  left: m(g.x_m),
                  top: m(g.y_m),
                  width: m(g.w_m),
                  height: m(g.h_m),
                  borderColor: highlighted ? colors.accent : mapColors.muted,
                  backgroundColor: highlighted ? mapColors.highlightFill : mapColors.gridFill,
                  transform: [{ rotate: `${g.rotation_deg || 0}deg` }],
                },
              ]}
            >
              <Text style={styles.rackLabel} numberOfLines={1}>{rack.rack_label || g.label}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendItem}>{t('map.legendForklift')}</Text>
        <Text style={[styles.legendItem, { color: mapColors.walkway }]}>{t('map.legendWalkway')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 12,
  },
  title: {
    fontFamily: fonts.mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  canvas: {
    position: 'relative',
    backgroundColor: mapColors.fill,
    borderRadius: radii.small,
    overflow: 'hidden',
  },
  warehouse: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: mapColors.borderStrong,
    backgroundColor: mapColors.surface,
    borderRadius: 4,
  },
  zone: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: mapColors.border,
    backgroundColor: mapColors.zoneFill,
    borderLeftWidth: 3,
  },
  rack: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 3,
    padding: 2,
  },
  rackLabel: {
    fontFamily: fonts.mono,
    fontSize: 7,
    color: colors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: mapColors.route,
  },
});
