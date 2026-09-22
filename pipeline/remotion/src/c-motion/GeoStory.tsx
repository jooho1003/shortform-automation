import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type GeoStoryProps = {
  islandSrc?: string;
  narrationSrc?: string;
};

const clamp = {
  extrapolateLeft: 'clamp' as const,
  extrapolateRight: 'clamp' as const,
};

const ease = Easing.bezier(0.2, 0.72, 0.28, 1);

function pinStyle(scale: number): React.CSSProperties {
  return {
    width: 26 / scale,
    height: 26 / scale,
    border: `${5 / scale}px solid #f7fbff`,
    borderRadius: '50%',
    background: '#ffc85a',
    boxShadow: `0 0 ${28 / scale}px rgba(255, 200, 90, .72)`,
  };
}

const MapScene: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const mapScale = interpolate(seconds, [0.25, 5.7], [1, 2.6], {...clamp, easing: ease});
  const mapX = interpolate(seconds, [0.25, 5.7], [0, 55], {...clamp, easing: ease});
  const mapY = interpolate(seconds, [0.25, 5.7], [0, -360], {...clamp, easing: ease});
  const route = interpolate(seconds, [2.7, 4.7], [940, 0], {...clamp, easing: Easing.inOut(Easing.cubic)});
  const titleOpacity = interpolate(seconds, [0, 0.35, 4.5, 5.25], [0, 1, 1, 0], clamp);
  const labelOpacity = interpolate(seconds, [1.4, 2.1], [0, 1], clamp);
  const mapOpacity = interpolate(seconds, [5.25, 6.1], [1, 0], clamp);

  return (
    <AbsoluteFill style={{overflow: 'hidden', background: '#0b3650', opacity: mapOpacity}}>
      <AbsoluteFill style={{background: 'radial-gradient(circle at 48% 56%, #2a7791 0%, #0d4766 48%, #082a43 100%)'}} />
      <div style={{position: 'absolute', inset: -240, transformOrigin: '46% 57%', transform: `translate(${mapX}px, ${mapY}px) scale(${mapScale})`}}>
        <svg viewBox="0 0 1080 2400" width="100%" height="100%" aria-hidden="true">
          <defs>
            <filter id="softShadow"><feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#041d2c" floodOpacity=".4" /></filter>
            <linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#b9aa79"/><stop offset="1" stopColor="#647b5c"/></linearGradient>
          </defs>
          <g fill="none" stroke="#d6eef4" strokeOpacity=".09" strokeWidth="2">
            <path d="M0 540H1080M0 800H1080M0 1060H1080M0 1320H1080M0 1580H1080" />
            <path d="M180 0V2400M420 0V2400M660 0V2400M900 0V2400" />
          </g>
          <g fill="url(#land)" stroke="#d2c799" strokeOpacity=".42" strokeWidth="5" filter="url(#softShadow)">
            <path d="M93 510C168 451 248 428 325 462L367 546 342 638 381 717 355 821 309 887 290 1036 235 1160 198 1095 179 943 130 837 109 708 65 624Z" />
            <path d="M681 390 796 406 887 474 934 585 889 681 856 817 779 930 719 878 695 749 630 633 611 501Z" />
            <path d="M859 895 902 973 874 1072 836 1040Z" />
          </g>
          <g fill="#d6eef4" fillOpacity=".24">
            <circle cx="713" cy="836" r="7"/><circle cx="641" cy="1079" r="7"/><circle cx="510" cy="1361" r="5"/>
          </g>
          <path d="M641 1079 C602 1162 558 1267 510 1361" fill="none" stroke="#65e4ff" strokeWidth="11" strokeLinecap="round" strokeDasharray="940" strokeDashoffset={route} />
          <circle cx="510" cy="1361" r="15" fill="#ffc85a" stroke="#fff" strokeWidth="6" />
        </svg>
        <div style={{position: 'absolute', left: 518, top: 1292, transform: `scale(${1 / mapScale})`, transformOrigin: 'left center', opacity: labelOpacity, color: '#fff', fontSize: 32, fontWeight: 800, whiteSpace: 'nowrap', textShadow: '0 2px 10px #061d2b'}}>트리스탄다쿠냐</div>
        <div style={{position: 'absolute', left: 498, top: 1347, transform: `scale(${1 / mapScale})`, transformOrigin: 'center', opacity: labelOpacity, ...pinStyle(mapScale)}} />
      </div>
      <div style={{position: 'absolute', top: 176, left: 72, right: 72, opacity: titleOpacity, textAlign: 'center', color: '#f7fbff', fontSize: 78, fontWeight: 900, letterSpacing: -3, textShadow: '0 5px 22px rgba(0,0,0,.6)'}}>지도에도 잘 안 보이는 섬</div>
      <div style={{position: 'absolute', left: 74, bottom: 188, width: 8, height: 108, borderRadius: 8, background: '#ffc85a', opacity: titleOpacity}} />
      <div style={{position: 'absolute', left: 110, right: 76, bottom: 182, opacity: titleOpacity, color: '#fff', fontSize: 58, fontWeight: 800, lineHeight: 1.28, textShadow: '0 4px 16px #061d2b'}}>남대서양 한가운데,<br/><span style={{color: '#ffc85a'}}>작은 점 하나</span>가 있습니다.</div>
    </AbsoluteFill>
  );
};

const Settler: React.FC<{left: number; delay: number; color: string}> = ({left, delay, color}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const enter = interpolate(seconds, [8.7 + delay, 9.15 + delay], [0, 1], {...clamp, easing: ease});
  return (
    <div style={{position: 'absolute', left, bottom: 455, width: 128, height: 220, opacity: enter, transform: `translateY(${(1-enter)*80}px) scale(${0.9+enter*0.1})`}}>
      <div style={{position: 'absolute', left: 31, top: 0, width: 66, height: 66, borderRadius: '50%', background: '#f0c6a4', border: '6px solid #24323b'}} />
      <div style={{position: 'absolute', left: 16, top: 52, width: 96, height: 112, borderRadius: '45% 45% 18% 18%', background: color, border: '6px solid #24323b'}} />
      <div style={{position: 'absolute', left: 10, top: 148, width: 44, height: 70, borderRadius: 20, background: '#26333c'}} />
      <div style={{position: 'absolute', right: 10, top: 148, width: 44, height: 70, borderRadius: 20, background: '#26333c'}} />
    </div>
  );
};

const IslandScene: React.FC<{src: string}> = ({src}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const seconds = frame / fps;
  const opacity = interpolate(seconds, [5.2, 6.05], [0, 1], clamp);
  const scale = interpolate(seconds, [5.2, 12], [1.08, 1.18], {...clamp, easing: Easing.out(Easing.cubic)});
  const question = interpolate(seconds, [6.2, 7.1], [0, 1], {...clamp, easing: ease});
  const name = interpolate(seconds, [7.25, 8.05], [0, 1], {...clamp, easing: ease});

  return (
    <AbsoluteFill style={{overflow: 'hidden', opacity, background: '#07263a'}}>
      <Img src={src} style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`}} />
      <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(3,18,28,.55) 0%, transparent 30%, transparent 62%, rgba(2,13,22,.86) 100%)'}} />
      <div style={{position: 'absolute', top: 164, left: 70, right: 70, opacity: question, transform: `translateY(${(1-question)*28}px)`, color: '#fff', textAlign: 'center', fontSize: 76, fontWeight: 900, lineHeight: 1.18, letterSpacing: -3, textShadow: '0 5px 20px rgba(0,0,0,.72)'}}>이 외딴곳에<br/>왜 마을이 생겼을까?</div>
      <div style={{position: 'absolute', left: 145, right: 145, bottom: 268, padding: '28px 34px', borderRadius: 28, opacity: name, transform: `translateY(${(1-name)*35}px)`, color: '#0d2633', background: 'rgba(250,244,223,.94)', textAlign: 'center', boxShadow: '0 18px 55px rgba(0,0,0,.34)'}}>
        <div style={{fontSize: 28, fontWeight: 800, letterSpacing: 3, color: '#3c6670'}}>SOUTH ATLANTIC</div>
        <div style={{fontSize: 62, fontWeight: 900, letterSpacing: -2}}>트리스탄다쿠냐</div>
      </div>
      <Settler left={315} delay={0} color="#b86143" />
      <Settler left={468} delay={0.12} color="#d9a23e" />
      <Settler left={621} delay={0.24} color="#557e8b" />
    </AbsoluteFill>
  );
};

export const GeoStory: React.FC<GeoStoryProps> = ({
  islandSrc = staticFile('c-motion/island-aerial.png'),
  narrationSrc = staticFile('c-motion/narration.mp3'),
}) => {
  return (
    <AbsoluteFill style={{fontFamily: 'Arial, "Malgun Gothic", sans-serif', background: '#07263a'}}>
      <MapScene />
      <IslandScene src={islandSrc} />
      {narrationSrc ? <Audio src={narrationSrc} volume={1} /> : null}
    </AbsoluteFill>
  );
};
