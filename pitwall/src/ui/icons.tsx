import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconName = 'live' | 'track' | 'temps' | 'sessions' | 'device';

/** Hand-drawn 24×24 line icons for the tab bar. */
export function Icon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }) {
  const s = { stroke: color, strokeWidth: 2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'live' && (
        <>
          <Circle cx={12} cy={13.5} r={7.5} {...s} />
          <Path d="M12 13.5 L15.5 10 M9.5 2.5 H14.5 M12 2.5 V6" {...s} />
        </>
      )}
      {name === 'track' && <Path d="M5 19 C2 15 6 13 6 9 C6 4 13 3 15 7 C16.5 10 20 9.5 20 13 C20 17 15 15 12 18 C10 20 7 21 5 19 Z" {...s} />}
      {name === 'temps' && (
        <>
          <Path d="M10 4 a2 2 0 0 1 4 0 V14 a4 4 0 1 1 -4 0 Z" {...s} />
          <Path d="M12 9 V16.5" {...s} />
          <Path d="M17 6 H20 M17 9.5 H20" {...s} />
        </>
      )}
      {name === 'sessions' && (
        <>
          <Rect x={4} y={4} width={16} height={16} rx={3} {...s} />
          <Path d="M8 9 H16 M8 12 H16 M8 15 H13" {...s} />
        </>
      )}
      {name === 'device' && (
        <>
          <Rect x={6} y={6} width={12} height={12} rx={2} {...s} />
          <Path d="M10 2.5 V6 M14 2.5 V6 M10 18 V21.5 M14 18 V21.5 M2.5 10 H6 M2.5 14 H6 M18 10 H21.5 M18 14 H21.5" {...s} />
        </>
      )}
    </Svg>
  );
}
